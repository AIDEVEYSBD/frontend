import type { NewPeer, Peer, PeerCard, PeerStatus } from "./api/l7b";
import { samePerson, type Access, type Me } from "./mcp-registry";

/**
 * What the console decides about a registered A2A peer before the backend
 * does (phase L7, second round): how each status reads, who may approve a
 * card, what moved between the approved card and the one a rescan pinned,
 * and whether the register form can be sent. The backend refuses the same
 * way (a 403 naming `two_person`, a 409 with no card to approve, a 400
 * naming the field); these stop a click, or explain a missing button,
 * before it gets that far. Pure: components/peers.tsx renders these,
 * tests/l7b-logic.test.ts holds them.
 */

/* ═══════════════════ status ═══════════════════ */

export interface PeerStatusMeta {
  label: string;
  tone: "ok" | "warn" | "err";
  /** A changed card stops a reader: the chip is solid and the row is marked. */
  alarming: boolean;
  /** What the status means for the traffic both ways, in a line. */
  means: string;
}

export const PEER_STATUS_META: Record<PeerStatus, PeerStatusMeta> = {
  approved: { label: "Approved", tone: "ok", alarming: false, means: "its pinned card is approved: runs here may hand it tasks, and it may hand tasks in" },
  pending: {
    label: "Pending approval",
    tone: "warn",
    alarming: false,
    means: "registered; nothing is sent to it, and it may read this factory's card but not hand in a task, until a person approves its card",
  },
  changed: {
    label: "Card changed",
    tone: "err",
    alarming: true,
    means: "a rescan found an agent card other than the approved one and pinned it, waiting; refused both ways (supply_chain) until someone approves the new card",
  },
};

/** Alarms first, then what waits for a person, then what is in service; by label within each. */
export function orderPeers(peers: readonly Peer[]): Peer[] {
  const order: PeerStatus[] = ["changed", "pending", "approved"];
  return [...peers].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/** How many peers are in each status, and how many have no card pinned (their last fetch failed). */
export function peerCounts(peers: readonly Peer[]): Record<PeerStatus, number> & { no_card: number } {
  const out = { approved: 0, pending: 0, changed: 0, no_card: 0 };
  for (const p of peers) {
    out[p.status] += 1;
    if (!p.card) out.no_card += 1;
  }
  return out;
}

/**
 * One row of the Control page's partner agents: a peer the registry holds,
 * or one a workflow names that it does not (`unregistered`: the runtime
 * refuses it), or, with no registry to read, `unknown`.
 */
export interface PartnerPeer {
  /** The registry's id, which is the name a spec's peer config uses. */
  name: string;
  /** The card's own name, else the registration's label. */
  title: string;
  url: string;
  /** The workflows that name it, comma-separated; "" when none does. */
  agent: string;
  status: PeerStatus | "unregistered" | "unknown";
  skills: number;
  /** The registry's last read of its card succeeded. */
  fetched: boolean;
}

/** A partner row's status in words, and its tone. */
export function partnerStatus(p: Pick<PartnerPeer, "status" | "skills" | "fetched">): { text: string; tone: "ok" | "warn" | "err" | "neutral" } {
  switch (p.status) {
    case "approved":
      return { text: `approved · ${p.skills} skill${p.skills === 1 ? "" : "s"}`, tone: "ok" };
    case "pending":
      return { text: p.fetched ? "pending approval" : "pending · no card", tone: "warn" };
    case "changed":
      return { text: "card changed", tone: "err" };
    case "unregistered":
      return { text: "not registered", tone: "err" };
    default:
      return { text: "registry unread", tone: "neutral" };
  }
}

/* ═══════════════════ the card ═══════════════════ */

/** One skill as a card lists it. */
export interface CardSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The skills a card lists, as the console shows them; empty for a card the backend read back from the runtime's file (digest only). */
export function skillsOf(card: PeerCard | null): CardSkill[] {
  const skills = obj(card?.card).skills;
  return (Array.isArray(skills) ? skills : [])
    .map((s): CardSkill => {
      const o = obj(s);
      const id = str(o.id);
      return { id, name: str(o.name) || id, description: str(o.description), tags: Array.isArray(o.tags) ? o.tags.map(str).filter(Boolean) : [] };
    })
    .filter((s) => s.id || s.name);
}

/** The card's own name and description, as the peer says them. */
export function cardTitle(card: PeerCard | null): { name: string; description: string; version: string } {
  const c = obj(card?.card);
  return { name: str(c.name), description: str(c.description), version: str(c.version) };
}

/** What moved between the approved card and the one a rescan pinned. */
export interface CardChange {
  /** The digest that was approved (`previous_card`). */
  from: string;
  /** The digest pinned now, waiting for an approval. */
  to: string;
  /** Top-level fields of the card whose value moved (description, url, capabilities…), skills aside. */
  fields: string[];
  added: string[];
  removed: string[];
  /** Same skill id, other name, description or tags. */
  rewritten: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The change a `changed` peer waits on, or null when there is none to read:
 * no card approved before, or the same digest. Read from the two cards the
 * registry keeps; a card read back from the runtime's file has its digest
 * only, so the change is the digests alone.
 */
export function cardChange(p: Pick<Peer, "card" | "previous_card">): CardChange | null {
  const before = p.previous_card;
  const after = p.card;
  if (!before || !after || before.digest === after.digest) return null;
  // Without both bodies, only the digests are known to differ.
  if (!before.card || !after.card) return { from: before.digest, to: after.digest, fields: [], added: [], removed: [], rewritten: [] };
  const was = before.card;
  const now = after.card;
  const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((k) => k !== "skills").sort();
  const old = new Map(skillsOf(before).map((s) => [s.id || s.name, s]));
  const neu = new Map(skillsOf(after).map((s) => [s.id || s.name, s]));
  return {
    from: before.digest,
    to: after.digest,
    fields: keys.filter((k) => !same(was[k], now[k])),
    added: [...neu.keys()].filter((k) => !old.has(k)),
    removed: [...old.keys()].filter((k) => !neu.has(k)),
    rewritten: [...neu.entries()].filter(([k, s]) => old.has(k) && !same(old.get(k), s)).map(([k]) => k),
  };
}

/** A change in one line: `description changed; skill forward added`. */
export function cardChangeLine(c: CardChange): string {
  const parts = [
    c.fields.length ? `${c.fields.join(", ")} changed` : "",
    c.rewritten.length ? `skill${c.rewritten.length === 1 ? "" : "s"} ${c.rewritten.join(", ")} rewritten` : "",
    c.added.length ? `skill${c.added.length === 1 ? "" : "s"} ${c.added.join(", ")} added` : "",
    c.removed.length ? `skill${c.removed.length === 1 ? "" : "s"} ${c.removed.join(", ")} removed` : "",
  ].filter(Boolean);
  return parts.join("; ");
}

/** The digest the latest approval approved, or "" when nobody has. */
export function approvedDigest(p: Pick<Peer, "approvals">): string {
  return p.approvals.at(-1)?.digest ?? "";
}

/* ═══════════════════ the last fetch ═══════════════════ */

/**
 * The last card fetch in words: ok, or why it failed. A failure is kept,
 * not refused: a peer that does not know this control plane yet answers
 * 401, which is how two factories meet (each registers the other before
 * either can answer), so the row says to rescan once the other side has.
 */
export function fetchLine(p: Pick<Peer, "last_fetch" | "card"> & { adopted?: Peer["adopted"] }): { ok: boolean; text: string } {
  const f = p.last_fetch;
  if (!f) {
    if (!p.card) return { ok: false, text: "never fetched" };
    return { ok: true, text: p.adopted ? "no fetch on record; the card was read back from the runtime's file" : "no fetch on record" };
  }
  if (f.ok) return { ok: true, text: "the card was read, signed, and its signature checked" };
  const why = f.error || "the fetch failed";
  const hint = /\b401\b/.test(why)
    ? "; rescan once the peer has registered this platform"
    : /unreachable|refused|timed out|timeout/i.test(why)
      ? "; rescan once it answers"
      : "";
  return { ok: false, text: `${why}${f.control ? ` (${f.control})` : ""}${hint}` };
}

/* ═══════════════════ who may approve ═══════════════════ */

/**
 * Whether this person may approve the peer's card now. A pending or changed
 * card waits for an approval; an approved one has it; a peer whose card was
 * never read has nothing to approve (409) until a rescan pins one. With
 * two-person approval on, whoever registered it may not approve it (the
 * backend compares the same signer, 403 `two_person`). The configure
 * permission is the button's own check.
 */
export function approvePeerAccess(peer: Pick<Peer, "status" | "card" | "added_by">, me: Me | null, twoPerson: boolean): Access {
  if (peer.status === "approved") return { ok: false, reason: "the card is already approved" };
  if (!peer.card) return { ok: false, reason: "no agent card is pinned yet: rescan once the peer answers" };
  if (twoPerson) {
    if (!me) return { ok: false, reason: "who you are is not known yet" };
    if (samePerson(peer.added_by, me)) return { ok: false, reason: "a second person must approve" };
  }
  return { ok: true, reason: "" };
}

/* ═══════════════════ the register form ═══════════════════ */

export interface PeerForm {
  label: string;
  /** Optional: the backend derives one from the label. */
  id: string;
  url: string;
  /** The vault name, or `${secret:name}`. */
  secret_name: string;
  /** Optional: who this factory says it is to the peer; the deployment's own id when blank. */
  agent: string;
  /** Optional: what it returns, and the floor of what it hands in. */
  data_class: string;
  /** Optional: the highest class it may be handed. */
  max_data_class: string;
}

export const EMPTY_PEER_FORM: PeerForm = { label: "", id: "", url: "", secret_name: "", agent: "", data_class: "", max_data_class: "" };

/** The backend's rules (backend/app/peers.py, app/a2a_client.py). */
const PEER_ID = /^[a-z][a-z0-9_-]{0,62}$/;
const SECRET_NAME = /^[a-z0-9_-]{1,64}$/;
const SECRET_REF = /^\$\{secret:([A-Za-z0-9_-]{1,64})\}$/;

/** The vault name a registration's secret must be: `name` or `${secret:name}`, lowercased; "" for anything else, a value pasted where a name belongs among them. */
export function secretNameOf(raw: string): string {
  const text = raw.trim();
  const ref = SECRET_REF.exec(text);
  const name = (ref ? ref[1] : text).toLowerCase();
  return SECRET_NAME.test(name) ? name : "";
}

/** The id the backend derives from a label when none is given. */
export function slugOfLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 63)
    .replace(/-+$/, "");
}

/** The form's first problem, or "" when it can be sent. The backend checks again, the vault's holding of the name among it. */
export function peerFormProblem(f: PeerForm): string {
  const id = f.id.trim() || slugOfLabel(f.label);
  if (!id) return "Name the peer.";
  if (!PEER_ID.test(id)) return "An id starts with a lowercase letter, then lowercase letters, digits, - or _, up to 63 characters.";
  const url = f.url.trim();
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.hostname) return "Give the peer's A2A endpoint, an http(s) URL.";
  if (parsed.username || parsed.password || /^https?:\/\/[^/?#]*@/i.test(url)) return "A URL carries no credentials: the two sides sign with the shared secret.";
  if (url.includes("?") || url.includes("#")) return "The endpoint takes no query or fragment; its card is read at {url}/.well-known/agent.json.";
  if (!f.secret_name.trim()) return "Name the vault secret the two sides share.";
  if (!secretNameOf(f.secret_name)) return "The secret is its vault name (lowercase letters, digits, - or _), or ${secret:name}; never the secret itself.";
  const agent = f.agent.trim();
  if (agent && !PEER_ID.test(agent)) return `"${agent}" is not an agent id.`;
  return "";
}

/** The contract's `POST /api/peers` body from the form; blank optional fields are left out. */
export function peerBody(f: PeerForm): NewPeer {
  const body: NewPeer = { label: f.label.trim(), url: f.url.trim(), secret_name: f.secret_name.trim() };
  if (f.id.trim()) body.id = f.id.trim();
  if (f.agent.trim()) body.agent = f.agent.trim();
  if (f.data_class) body.data_class = f.data_class as NewPeer["data_class"];
  if (f.max_data_class) body.max_data_class = f.max_data_class as NewPeer["max_data_class"];
  return body;
}

/** A peer's classes, as its row says them. */
export function peerClassLine(p: Pick<Peer, "data_class" | "max_data_class">): string {
  return `Returns ${p.data_class || "undeclared"} · takes ${p.max_data_class ? `up to ${p.max_data_class}` : "no limit here"}`;
}
