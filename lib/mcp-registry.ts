import { controlLabel } from "./guardrails";
import { isPlatformAdmin } from "./permissions";
import { kvLines, type AddForm, type McpServer, type Pin, type PinnedTool, type ScreenHit, type ServerStatus } from "./api/l6";

/**
 * What the console decides about a registered tool server before the
 * backend does (phase L6): how each status reads, who may approve a pin,
 * which servers the builder may offer tools from, and whether the add form
 * can be sent. The backend refuses the same way (a 403 naming `two_person`,
 * the runtime's `supply_chain` refusal at attach); these only stop a click,
 * or explain a missing tool, before it gets that far.
 */

/* ═══════════════════ status ═══════════════════ */

export interface StatusMeta {
  label: string;
  tone: "ok" | "warn" | "err";
  /** Changed and refused stop a reader: the chip is solid and the row is marked. */
  alarming: boolean;
  /** What the status means for a run, in a line. */
  means: string;
}

export const STATUS_META: Record<ServerStatus, StatusMeta> = {
  approved: { label: "Approved", tone: "ok", alarming: false, means: "its pinned tool list attaches to runs" },
  pending: { label: "Pending approval", tone: "warn", alarming: false, means: "nothing attaches until a platform admin approves its pinned list and sets its tools' risks; a server whose headers name a vault credential is first approved, by a second person, for its address and credentials, and only then is its list read and pinned" },
  changed: { label: "Tools changed", tone: "err", alarming: true, means: "the tool list moved from the approved one; detached until a platform admin approves the list again" },
  refused: { label: "Refused", tone: "err", alarming: true, means: "the screener refused its tool list, at admission, when the list was first read on approving its credentials, or on a rescan; it never attaches" },
};

/** The pinned tool list: what an approval admits, and all a run gets once it is approved. For a `changed` server it is the new list, waiting for that approval. */
export function pinnedTools(s: McpServer): PinnedTool[] {
  return s.pin?.tools ?? [];
}

/** How the tool list moved, tool by tool: added, removed, and kept under the same name with its description, schema or hints rewritten. */
export interface PinChange {
  /** The digest of the list that was approved (`previous_pin`). */
  from: string;
  /** The digest of the list found: the new pin, or (refused on a rescan) the list the screener refused. */
  to: string;
  added: string[];
  removed: string[];
  /** Same name, other description, input schema or hints: the rug-pull a pin exists to catch. */
  rewritten: string[];
}

const sameTool = (a: PinnedTool, b: PinnedTool) =>
  a.description === b.description && JSON.stringify(a.inputSchema) === JSON.stringify(b.inputSchema) && JSON.stringify(a.annotations ?? {}) === JSON.stringify(b.annotations ?? {});

/**
 * What moved since the list a person approved, or null when nothing did.
 * The backend keeps the approved list as `previous_pin` when a rescan finds
 * another: a clean list becomes the pin (`changed`, waiting for an
 * approval), a poisoned one is refused (no pin; the refused list is only a
 * digest on the scan). The console reads the change from those, never from
 * the scan against the pin, which agree once a rescan has pinned what it
 * found.
 */
export function pinChange(s: McpServer): PinChange | null {
  const before: Pin | null = s.previous_pin;
  if (!before) return null;
  const after = s.pin;
  const to = after?.digest || s.last_scan?.digest || "";
  if (!to || to === before.digest) return null;
  const old = new Map(before.tools.map((t) => [t.name, t]));
  const now = new Map((after?.tools ?? []).map((t) => [t.name, t]));
  return {
    from: before.digest,
    to,
    added: after ? [...now.keys()].filter((n) => !old.has(n)) : [],
    removed: after ? [...old.keys()].filter((n) => !now.has(n)) : [],
    rewritten: after ? [...now.entries()].filter(([n, t]) => old.has(n) && !sameTool(old.get(n)!, t)).map(([n]) => n) : [],
  };
}

/** A change in one line: `lookup rewritten; export added`. */
export function changeLine(c: PinChange): string {
  const parts = [
    c.rewritten.length ? `${c.rewritten.join(", ")} rewritten` : "",
    c.added.length ? `${c.added.join(", ")} added` : "",
    c.removed.length ? `${c.removed.join(", ")} removed` : "",
  ].filter(Boolean);
  return parts.join("; ");
}

/**
 * The hints a pinned tool carries, in words, and the risk they suggest. They
 * are the server's own word about itself: shown to the platform admin who
 * sets the risk, never used as the risk. Read the way the MCP specification
 * defaults them (and the registry reads them, `risk_from_hints`): read when
 * the tool says it only reads, write when it says it is not destructive,
 * else destructive.
 */
export function toolHints(t: Pick<PinnedTool, "annotations" | "risk_from_hints">): { risk: "read" | "write" | "destructive"; hints: string[] } {
  const a = t.annotations ?? {};
  const said = t.risk_from_hints;
  const risk = said === "read" || said === "write" || said === "destructive" ? said : a.readOnlyHint === true ? "read" : a.destructiveHint === false ? "write" : "destructive";
  const hints = [
    a.readOnlyHint === true ? "read-only" : "",
    a.destructiveHint === true ? "destructive" : "",
    a.idempotentHint === true ? "idempotent" : "",
    a.openWorldHint === true ? "open world" : "",
  ].filter(Boolean);
  return { risk, hints };
}

export const RISKS = ["read", "write", "risky", "destructive"] as const;
export type ToolRisk = (typeof RISKS)[number];

/**
 * A pinned tool's risk as the platform registers it: the one the approving
 * platform admin set for this pin, or destructive when none was set (the
 * registry drops risks set for another pin). `set` says which.
 */
export function toolRisk(t: Pick<PinnedTool, "risk">): { risk: ToolRisk; set: boolean } {
  const r = t.risk;
  return r && (RISKS as readonly string[]).includes(r) ? { risk: r as ToolRisk, set: true } : { risk: "destructive", set: false };
}

/**
 * An entry adopted from before the registry, in a line: where from, and
 * whether it has been screened since. Approving one screens its pinned
 * tools first; a clean screening there leaves no scan on the entry, so an
 * approved adopted entry says it was screened when it was approved.
 */
export function adoptedLine(s: McpServer): string {
  if (!s.adopted) return "";
  const from = s.adopted.from === "setting" ? "the registry setting" : s.adopted.from || "an older record";
  const since = s.status === "approved" ? "its pinned tools were screened when it was approved" : s.last_scan ? "it has been scanned since" : "approving it screens its pinned tools first";
  return `adopted from ${from}, written before the registry screened anything; ${since}`;
}

/** Where a stdio server runs, when its registration isolates it. */
export function isolationLine(s: McpServer): string {
  if (!s.isolate) return "";
  const image = s.isolate.image ? `image ${s.isolate.image}` : "the deployment's image";
  const network = s.isolate.network ? `network ${s.isolate.network}` : "no network";
  return `in a container: ${image}, ${network}`;
}

/** A screener hit in one line: `description of lookup_vendor: Content screening (injection.input)`. */
export function hitLine(h: ScreenHit): string {
  const label = controlLabel(h.control);
  return `${h.field} of ${h.tool || "the server"}: ${label}${label === h.control ? "" : ` (${h.control})`}`;
}

/* ═══════════════════ who may approve ═══════════════════ */

/** The person at the console, as the session names them. */
export interface Me {
  name: string;
  email: string;
  sub?: string;
  /** The person's app roles: only a platform admin approves a tool server. */
  roles?: readonly string[];
}

const emailIn = (s: string): string => {
  const angled = s.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1];
  if (angled) return angled.toLowerCase();
  const bare = s.trim();
  return /^[^\s@<>]+@[^\s@<>]+$/.test(bare) ? bare.toLowerCase() : "";
};
const nameIn = (s: string): string => s.replace(/<[^>]*>/g, "").trim().toLowerCase();

/**
 * Whether a registry signature names this person. The backend signs as
 * `Name <email>` when the session has an email and as the bare name
 * otherwise (local mode), so an email decides when both sides carry one,
 * and the name (or the email, or the subject, written bare) otherwise.
 */
export function samePerson(by: string, me: Me | null): boolean {
  if (!by.trim() || !me) return false;
  const theirs = emailIn(by);
  const mine = me.email.trim().toLowerCase();
  if (theirs && mine) return theirs === mine;
  const n = nameIn(by);
  if (!n) return false;
  return [me.name, me.email, me.sub ?? ""].some((x) => x.trim() && x.trim().toLowerCase() === n);
}

export interface Access {
  ok: boolean;
  /** Why not, in a line shown beside the disabled button. */
  reason: string;
}

/** A server row with the registry's credentials flag, which the generated schema does not carry. */
type WithCredentials = McpServer & { credentials_waiting?: boolean; credentials?: string[] };

/** Whether nothing has been sent to the server yet because its vault credentials wait for a second person (`credentials_waiting`). */
export const credentialsWaiting = (s: WithCredentials): boolean => s.credentials_waiting === true;

/**
 * Whether this person may approve the server now, and what the approval is.
 *
 * A server whose credentials wait is approved for its address and the
 * headers it is sent, with no body: that is what sends them for the first
 * time, so the person who registered it never may, whatever the setting
 * (the backend answers 403 `two_person`). Otherwise pending and changed pins
 * wait for an approval; an approved one has it, and a refused server has no
 * pin worth approving (rescan it once the server is fixed, or delete it).
 * With two-person approval on, the person who registered the server may not
 * approve it; an entry adopted from before the registry names nobody, so
 * anyone may (the backend compares the same). The configure permission is
 * the button's own check.
 */
export function approveAccess(server: WithCredentials, me: Me | null, twoPerson: boolean): Access & { credentials: boolean } {
  const credentials = credentialsWaiting(server);
  const no = (reason: string) => ({ ok: false, reason, credentials });
  if (server.status === "refused") return no(`refused ${refusedWhen(server)}; rescan once the server is fixed, or delete it`);
  if (!credentials && !server.pin) return no("it has no tool list to approve; rescan it first");
  if (!me) return no("who you are is not known yet");
  if (!isPlatformAdmin(me.roles)) return no(credentials ? "only a platform admin approves sending a server its credentials" : "only a platform admin approves a tool server and sets its tools' risks");
  if (credentials && samePerson(server.added_by, me)) return no("you registered it: a second platform admin approves sending its credentials to its address");
  if (twoPerson && samePerson(server.added_by, me)) return no("a second person must approve");
  return { ok: true, reason: "", credentials };
}

/** Why a rescan cannot run now, or "" when it can: a server whose credentials wait is sent nothing, a rescan included (the backend answers 409). */
export function rescanBlocked(server: WithCredentials): string {
  return credentialsWaiting(server) ? "nothing is sent to it, a rescan included, until a second platform admin approves its address and credentials" : "";
}

/* ═══════════════════ the builder's tool rail ═══════════════════ */

export interface HeldServer {
  server: McpServer;
  /** Why its tools are not on offer, in one line. */
  reason: string;
}

/** Why the builder holds a server's tools back, in one line. */
export function heldReason(s: WithCredentials): string {
  if (credentialsWaiting(s)) return "its headers name vault credentials a second platform admin has not yet approved sending to its address; nothing has been sent to it and its tool list has not been read";
  if (s.status === "pending") return s.adopted && !s.last_scan ? "adopted from before the registry and never screened; its tools appear once someone approves the pin in Configuration" : "pending approval; its tools appear once the pin is approved in Configuration";
  if (s.status === "changed") {
    const c = pinChange(s);
    const what = c ? changeLine(c) : "";
    return `its tool list changed since approval${what ? ` (${what})` : ""}; detached until someone approves it again in Configuration`;
  }
  if (s.status === "refused") {
    const hit = s.last_scan?.hits[0];
    const when = `refused ${refusedWhen(s)}`;
    return hit ? `${when}: ${hitLine(hit)}` : `${when} by the screener`;
  }
  return "";
}

/**
 * When a refused server was refused: at admission (no pin was ever kept),
 * when someone approved it (an adopted entry's pinned list is screened then,
 * so the refused list is the one it was pinned on), or on a rescan (the
 * screener refused a list other than the one it was pinned on).
 */
export function refusedWhen(s: WithCredentials & { credentials_approval?: unknown }): "at admission" | "when its credentials were approved" | "when it was approved" | "on a rescan" {
  // A server whose headers name the vault is first read when its credentials are approved: a list refused then was never pinned.
  if (!s.previous_pin) return s.credentials_approval ? "when its credentials were approved" : "at admission";
  return s.last_scan?.digest === s.previous_pin.digest ? "when it was approved" : "on a rescan";
}

/**
 * The tool rail's split: servers whose pin is approved offer their pinned
 * tools; every other server is listed, held, with the reason, so an author
 * knows why a tool is missing rather than assuming it never existed.
 */
export function railOf(servers: readonly McpServer[] | null): { usable: McpServer[]; held: HeldServer[] } {
  const usable: McpServer[] = [];
  const held: HeldServer[] = [];
  for (const s of servers ?? []) {
    if (s.status === "approved") usable.push(s);
    else held.push({ server: s, reason: heldReason(s) });
  }
  return { usable, held };
}

/* ═══════════════════ the add form ═══════════════════ */

/** The registry's rule for a server id. */
const ID = /^[a-z][a-z0-9_-]{0,62}$/;
/**
 * Ids the registry refuses: `server` (the platform's own MCP server answers
 * at /api/mcp/server), `builtin`, and the names the platform's built-in
 * tools and other addresses use, which a server's tools would shadow.
 */
export const RESERVED_IDS = ["builtin", "server", "agents", "code", "dataset", "document", "documents", "engines", "events", "finding", "notify", "peers", "records", "retrieval", "sandbox", "spec", "store", "web"];
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
/** A vault reference inside a header value. */
const SECRET_REF = /\$\{secret:[A-Za-z0-9_-]{1,64}\}/;

/** The name on each line, split as lib/api/l6.ts kvLines splits it; `split` false when the line has no separator. */
function lineNames(text: string, seps: string): { name: string; split: boolean }[] {
  const out: { name: string; split: boolean }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const at = Math.min(...[...seps].map((s) => t.indexOf(s)).filter((i) => i > 0));
    out.push(Number.isFinite(at) ? { name: t.slice(0, at).trim(), split: true } : { name: t, split: false });
  }
  return out;
}

/** The form's first problem, or "" when it can be sent. The backend checks again. */
export function formProblem(f: AddForm): string {
  if (!f.label.trim()) return "Name the server.";
  const id = f.id.trim();
  if (id && !ID.test(id)) return "An id starts with a lowercase letter, then lowercase letters, digits, - or _, up to 63 characters.";
  // /api/mcp/server is the platform's own MCP server, the console's; a registered server by that id could never be removed.
  if (id === "server") return "The id \"server\" is reserved for the platform's own MCP server.";
  if (RESERVED_IDS.includes(id)) return `"${id}" is a server the runtime serves itself; give this one another id.`;
  // Only a remote server is registered, by its address: the platform starts no server itself.
  const url = f.url.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return "Give the address the server answers on, starting https://.";
  // The registry refuses userinfo in an address; a credential belongs in a header, as a vault reference.
  if (/^https?:\/\/[^/\s?#]*@/i.test(url)) return "An address carries no credentials: put them in a header as a vault reference, such as Authorization: Bearer ${secret:my-token}.";
  if (/[?#]/.test(url)) return "An address carries no query or fragment: anything else, a key included, goes in a header that names a vault credential.";
  if (/^http:\/\//i.test(url) && !/^http:\/\/(localhost|127\.[0-9.]+|\[::1\])(:[0-9]+)?(\/|$)/i.test(url)) return "A tool server is reached over https; http only at a loopback address.";
  const bad = lineNames(f.headers, ":=").find((l) => !l.split || !HEADER_NAME.test(l.name));
  if (bad) return bad.split ? `"${bad.name}" is not a header name.` : `"${bad.name}" needs a value: one Name: value per line.`;
  // Every header value takes its value from the vault: no credential, and no other literal, is stored with a registration.
  const literal = Object.entries(kvLines(f.headers, ":=")).find(([, v]) => !SECRET_REF.test(v));
  if (literal) return `The header "${literal[0]}" must take its value from the vault, as \${secret:name}, with any text around it ("Bearer \${secret:name}").`;
  return "";
}
