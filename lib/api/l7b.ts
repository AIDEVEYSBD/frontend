import { errorText, type Schemas } from "./client";
import { DoorError } from "./l5";

/**
 * The L7 doors of the second round (backend/CONTRACT.md, "L7: multi-agent
 * systems governed", "As built (backend, L7 second half)"): the peer
 * registry and the estate's breakers. The kill's `peer_task` rows and the
 * `cancelled` job status are read where the first round's and L2's shapes
 * already are (lib/api/l7.ts reachedOf, lib/api/l2.ts the queue); an
 * attached agent's `secret_name` travels on the generated client (lib/api/l2.ts
 * setAttachedPolicy) since `npm run gen:api` took the backend's document.
 *
 * Every shape here was written against responses captured from the
 * backend's own app, driven in-process through its doors with the runtime's
 * A2A stub on a socket as the peer; tests/l7b-contract.test.ts replays them
 * through the calls and mappings below with fetch stubbed and holds each
 * console shape to the generated schema field by field. The calls are plain
 * fetches read by mapping functions, as lib/api/l6.ts and l7.ts do: a
 * refusal carries more than the generated ErrorBody types (the control on a
 * 403, the field on a 400 or 409, the peer a failed rescan recorded on a
 * 502), and every answer is read defensively. Same-origin: proxy.ts forwards
 * `/api/peers` and `/api/breakers` to the backend (lib/route-policy.ts
 * BACKEND_PREFIXES), behind the cookie.
 *
 * Registering a peer is admission, not trust, as registering a tool server
 * is: its agent card is fetched signed under the shared secret and pinned by
 * digest, and the peer waits, pending, until a person approves the card. The
 * secret is a vault name, never a value, and no value ever comes back.
 */

/* ═══════════════════ reading ═══════════════════ */

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v === null || v === undefined ? d : String(v));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const isObj = (v: unknown): boolean => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/* ═══════════════════ the peer registry ═══════════════════ */

export type PeerStatus = Schemas["Peer"]["status"];
export const PEER_STATUSES: PeerStatus[] = ["pending", "approved", "changed"];

/** An agent card as pinned: its digest (`sha256:…`, the runtime's `a2a.card_digest`), the card as fetched, and when. */
export interface PeerCard {
  digest: string;
  /** null for an entry read back from the runtime's file, which keeps only the digest. */
  card: Record<string, unknown> | null;
  at: string;
}

export interface PeerApproval {
  by: string;
  at: string;
  /** The card digest this approval approved. */
  digest: string;
}

/** The last time the registry asked the peer for its card. */
export interface PeerFetch {
  at: string;
  by: string;
  ok: boolean;
  digest: string;
  /** Why it failed: unreachable, a 401 from a peer that does not know this control plane yet, an answer unsigned or signed under another secret. */
  error: string;
  /** The control that refused, when one did (`a2a_auth`, `egress`); "" otherwise. */
  control: string;
}

/** An entry read back from the runtime's `peers.json` because the setting was gone: when, and from where. */
export type PeerAdoption = { at: string; from: string };

/** A registered peer, as `GET /api/peers` lists it. */
export interface Peer {
  /** The name a spec's peer config uses, and the `x-af-agent` the peer calls in as. */
  id: string;
  label: string;
  /** Its A2A endpoint: JSON-RPC is posted here; its card is `{url}/.well-known/agent.json`. */
  url: string;
  /** The vault name of the secret the two sides share. Never the value. */
  secret_name: string;
  /** Who this control plane says it is (`x-af-agent`) on the registry's own requests to the peer. */
  agent: string;
  status: PeerStatus;
  /** The pinned card; for a `changed` peer, the new one, waiting for an approval. null until a fetch succeeds. */
  card: PeerCard | null;
  /** The card a `changed` peer moved away from: the one approved. */
  previous_card: PeerCard | null;
  approvals: PeerApproval[];
  /** The signer who registered it (`Name <email>`, or the bare name in local mode). */
  added_by: string;
  added_at: string;
  last_fetch: PeerFetch | null;
  adopted: PeerAdoption | null;
  /** What it returns, and the floor of what it hands in; "" undeclared. */
  data_class: string;
  /** The highest class it may be handed; "" no limit here. A spec's own holds beside it, and the lower decides. */
  max_data_class: string;
}

/** `GET /api/peers` */
export interface PeerRegistry {
  peers: Peer[];
  count: number;
  /** Approval needs a second person: whoever registered a peer may not approve it. */
  two_person: boolean;
}

/** `POST /api/peers` */
export interface NewPeer {
  label?: string;
  /** Optional: the backend derives one from the label. */
  id?: string;
  url: string;
  /** A vault name, or `${secret:name}`; never the secret itself. */
  secret_name: string;
  /** Who this control plane says it is to this peer; the deployment's `A2A_AGENT_ID` when left out. */
  agent?: string;
  /** Optional: what it returns, and the floor of what it hands in. */
  data_class?: Schemas["PeerAddRequest"]["data_class"];
  /** Optional: the highest class it may be handed. */
  max_data_class?: Schemas["PeerAddRequest"]["max_data_class"];
}

/** `POST /api/peers/{id}/rescan` */
export interface PeerRescan {
  peer: Peer;
  /** The card's digest moved from the pin: the peer is `changed` until someone approves the new card. */
  changed: boolean;
}

export function peerCardOf(v: unknown): PeerCard | null {
  if (!isObj(v)) return null;
  const c = obj(v);
  if (!str(c.digest)) return null;
  return { digest: str(c.digest), card: isObj(c.card) ? obj(c.card) : null, at: str(c.at) };
}

export function peerFetchOf(v: unknown): PeerFetch | null {
  if (!isObj(v)) return null;
  const f = obj(v);
  return { at: str(f.at), by: str(f.by), ok: f.ok === true, digest: str(f.digest), error: str(f.error), control: str(f.control) };
}

function approvalOf(v: unknown): PeerApproval {
  const a = obj(v);
  return { by: str(a.by), at: str(a.at), digest: str(a.digest) };
}

/** A peer row, normalised: every field the console reads is present, defaulted where the backend left it out. */
export function peerOf(v: unknown): Peer {
  const p = obj(v);
  const adopted = obj(p.adopted);
  return {
    id: str(p.id),
    label: str(p.label) || str(p.id),
    url: str(p.url),
    secret_name: str(p.secret_name),
    agent: str(p.agent),
    status: PEER_STATUSES.find((s) => s === p.status) ?? "pending",
    card: peerCardOf(p.card),
    previous_card: peerCardOf(p.previous_card),
    approvals: (Array.isArray(p.approvals) ? p.approvals : []).map(approvalOf),
    added_by: str(p.added_by),
    added_at: str(p.added_at),
    last_fetch: peerFetchOf(p.last_fetch),
    adopted: isObj(p.adopted) ? { at: str(adopted.at), from: str(adopted.from) } : null,
    data_class: str(p.data_class),
    max_data_class: str(p.max_data_class),
  };
}

export function peerRegistryOf(v: unknown): PeerRegistry {
  const o = obj(v);
  const peers = (Array.isArray(o.peers) ? o.peers : []).map(peerOf).filter((p) => p.id);
  return { peers, count: num(o.count, peers.length), two_person: o.two_person === true };
}

/* ═══════════════════ the estate's breakers ═══════════════════ */

/** calls: the estate's rate past `calls` in `window_s`; failures: that many failed in a row; probe: failed again once the cooldown let one through. */
export type BreakerWhy = "calls" | "failures" | "probe";

/** The thresholds every breaker is judged by (`AF_BREAKER_*`, or the `breakers` settings row over them); 0 turns `calls` or `failures` off. */
export interface BreakerThresholds {
  calls: number;
  window_s: number;
  failures: number;
  cooldown_s: number;
}

/** One time an estate breaker opened. */
export interface BreakerOpening {
  /** The sink tool, or `peer:<name>` for a peer. */
  name: string;
  /** One of BreakerWhy, or whatever a newer backend names. */
  why: string;
  /** The calls in the window, or the failures in a row, that opened it. */
  count: number;
  opened_at: string;
  /** When it closes on its own (half-open: the next failure opens it again at once). */
  until: string;
  /** Open now: `until` has not passed and nobody closed it. */
  open: boolean;
  /** When a person closed it by hand; "" otherwise. */
  closed_at: string;
  /** Where it was seen: the run whose entry tripped it, its agent, where that run runs. */
  run: string;
  agent: string;
  source: string;
  /** The thresholds it was judged by when it opened. */
  calls: number;
  window_s: number;
  failures: number;
  cooldown_s: number;
}

/** `GET /api/breakers` */
export interface BreakersView {
  /** What every worker is served on its claim and heartbeat: `{name: until}`. */
  open: Record<string, string>;
  thresholds: BreakerThresholds;
  /** The last openings, newest first, each once. */
  openings: BreakerOpening[];
}

export function thresholdsOf(v: unknown): BreakerThresholds {
  const t = obj(v);
  return { calls: num(t.calls), window_s: num(t.window_s), failures: num(t.failures), cooldown_s: num(t.cooldown_s) };
}

export function openingOf(v: unknown): BreakerOpening {
  const o = obj(v);
  return {
    name: str(o.name),
    why: str(o.why),
    count: num(o.count),
    opened_at: str(o.opened_at),
    until: str(o.until),
    open: o.open === true,
    closed_at: str(o.closed_at),
    run: str(o.run),
    agent: str(o.agent),
    source: str(o.source),
    calls: num(o.calls),
    window_s: num(o.window_s),
    failures: num(o.failures),
    cooldown_s: num(o.cooldown_s),
  };
}

/**
 * The view, normalised. An opening is listed once: the instance that
 * tripped a breaker serves it twice, from the shared row (its opening time
 * kept to the second) and from its own memory (to the microsecond), so the
 * list is read by name and the second it opened, newest first, the first
 * copy kept.
 */
export function breakersOf(v: unknown): BreakersView {
  const o = obj(v);
  const open: Record<string, string> = {};
  for (const [k, x] of Object.entries(obj(o.open))) if (typeof x === "string" && k) open[k] = x;
  const seen = new Set<string>();
  const openings: BreakerOpening[] = [];
  for (const raw of Array.isArray(o.openings) ? o.openings : []) {
    const x = openingOf(raw);
    if (!x.name) continue;
    const at = Date.parse(x.opened_at);
    const key = `${x.name}\u0000${Number.isNaN(at) ? x.opened_at : Math.floor(at / 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    openings.push(x);
  }
  return { open, thresholds: thresholdsOf(o.thresholds), openings };
}

/* ═══════════════════ calls ═══════════════════ */

/** One request to an L7b door: what is sent, before it is sent. */
export interface DoorRequest {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
}

const peerAt = (id: string) => `/api/peers/${encodeURIComponent(id)}`;

/** The registry door's requests, by action. Approve and rescan carry no body. */
export const PEERS = {
  list: (): DoorRequest => ({ method: "GET", path: "/api/peers" }),
  add: (body: NewPeer): DoorRequest => ({ method: "POST", path: "/api/peers", body }),
  approve: (id: string): DoorRequest => ({ method: "POST", path: `${peerAt(id)}/approve` }),
  rescan: (id: string): DoorRequest => ({ method: "POST", path: `${peerAt(id)}/rescan` }),
  remove: (id: string): DoorRequest => ({ method: "DELETE", path: peerAt(id) }),
};

/**
 * Where a breaker is closed. A peer's breaker is `peer:<name>`; the name is
 * one path segment, encoded, which the backend's router decodes back.
 */
export const breakerPath = (name: string) => `/api/breakers/${encodeURIComponent(name)}`;

export const BREAKERS = {
  view: (): DoorRequest => ({ method: "GET", path: "/api/breakers" }),
  close: (name: string): DoorRequest => ({ method: "DELETE", path: breakerPath(name) }),
};

/**
 * One request. A refusal is a DoorError carrying the body: the control on a
 * 403 (`two_person`), the field on a 400 or a 409 (`secret_name`, `url`,
 * `id`), the peer a failed rescan recorded on a 502. A bare 404, 502 or 503
 * with no body of the backend's means no backend answered the door.
 */
async function call<T>(req: DoorRequest, parse: (v: unknown) => T): Promise<T> {
  const res = await fetch(req.path, {
    method: req.method,
    headers: req.body === undefined ? undefined : { "content-type": "application/json" },
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    cache: "no-store",
    credentials: "include",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const page = typeof json !== "object" || json === null;
    const message = errorText(page ? (text.trimStart().startsWith("<") ? null : text) : json, res, req.method, req.path);
    throw new DoorError(message, res.status, obj(json));
  }
  return parse(json);
}

/** `GET /api/peers` (view): every registered peer with its status, pinned card and last fetch. */
export async function listPeers(): Promise<PeerRegistry> {
  return call(PEERS.list(), peerRegistryOf);
}

/**
 * `POST /api/peers` (configure): 201 with the peer, `pending`. A card that
 * could not be fetched is no refusal: the peer is kept with no card and the
 * fetch's error, and approving waits for a rescan that pins one. 400 names
 * the field (`secret_name` for a name the vault does not hold, or a value
 * pasted where the name belongs; `url`; `id`), 409 a taken id or a secret
 * another caller signs with.
 */
export async function addPeer(body: NewPeer): Promise<Peer> {
  return call(PEERS.add(body), (j) => peerOf(obj(j).peer ?? j));
}

/** `POST /api/peers/{id}/approve` (configure): the pinned card is approved and the peer is spoken to. 403 `two_person` for the person who registered it; 409 with no card to approve. */
export async function approvePeer(id: string): Promise<Peer> {
  return call(PEERS.approve(id), (j) => peerOf(obj(j).peer ?? j));
}

/** `POST /api/peers/{id}/rescan` (configure): the card fetched again; `changed` when its digest moved from the pin. A 502 is a fetch that failed, recorded on the peer (`peerOfRefusal`). */
export async function rescanPeer(id: string): Promise<PeerRescan> {
  return call(PEERS.rescan(id), (j) => ({ peer: peerOf(obj(j).peer ?? j), changed: obj(j).changed === true }));
}

/** `DELETE /api/peers/{id}` (configure): 204. */
export async function deletePeer(id: string): Promise<void> {
  await call(PEERS.remove(id), () => undefined);
}

/** The peer a refusal carries (a rescan's 502 records the failed fetch on it), or null. */
export function peerOfRefusal(e: unknown): Peer | null {
  if (!(e instanceof DoorError) || !isObj(e.body.peer)) return null;
  const p = peerOf(e.body.peer);
  return p.id ? p : null;
}

/** `GET /api/breakers` (view): what is open now, the thresholds, the last openings. */
export async function getBreakers(): Promise<BreakersView> {
  return call(BREAKERS.view(), breakersOf);
}

/** `DELETE /api/breakers/{name}` (configure): 204; every worker and every run here may call it again. 404 when none is open by that name. */
export async function closeBreaker(name: string): Promise<void> {
  await call(BREAKERS.close(name), () => undefined);
}
