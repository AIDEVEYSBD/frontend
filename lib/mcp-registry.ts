import { controlLabel } from "./guardrails";
import type { AddForm, McpServer, Pin, PinnedTool, ScreenHit, ServerStatus } from "./api/l6";

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
  pending: { label: "Pending approval", tone: "warn", alarming: false, means: "admitted and pinned; nothing attaches until a person approves the pin" },
  changed: { label: "Tools changed", tone: "err", alarming: true, means: "a rescan found a tool list other than the approved one and pinned it, waiting; detached until someone approves the new list" },
  refused: { label: "Refused", tone: "err", alarming: true, means: "the screener refused its tool list, at admission or on a rescan; it never attaches" },
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
 * The hints a pinned tool carries, in words, and the risk they seed a spec
 * binding with in the builder (lib/use-mcp.ts toolOf): destructive when it
 * says so, read when it says it only reads, else write. An unknown tool is
 * never assumed harmless.
 */
export function toolHints(t: Pick<PinnedTool, "annotations">): { risk: "read" | "write" | "destructive"; hints: string[] } {
  const a = t.annotations ?? {};
  const risk = a.destructiveHint === true ? "destructive" : a.readOnlyHint === true ? "read" : "write";
  const hints = [
    a.readOnlyHint === true ? "read-only" : "",
    a.destructiveHint === true ? "destructive" : "",
    a.idempotentHint === true ? "idempotent" : "",
    a.openWorldHint === true ? "open world" : "",
  ].filter(Boolean);
  return { risk, hints };
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

/**
 * Whether this person may approve the server's pin now. Pending and changed
 * pins wait for an approval; an approved one has it, and a refused server
 * has no pin worth approving (rescan it once the server is fixed, or delete
 * it). With two-person approval on, the person who registered the server
 * may not approve it; an entry adopted from before the registry names
 * nobody, so anyone may (the backend compares the same). The configure
 * permission is the button's own check.
 */
export function approveAccess(server: McpServer, me: Me | null, twoPerson: boolean): Access {
  if (server.status === "approved") return { ok: false, reason: "the pin is already approved" };
  if (server.status === "refused") return { ok: false, reason: `refused ${refusedWhen(server)}; rescan once the server is fixed, or delete it` };
  if (twoPerson) {
    if (!me) return { ok: false, reason: "who you are is not known yet" };
    if (samePerson(server.added_by, me)) return { ok: false, reason: "a second person must approve" };
  }
  return { ok: true, reason: "" };
}

/* ═══════════════════ the builder's tool rail ═══════════════════ */

export interface HeldServer {
  server: McpServer;
  /** Why its tools are not on offer, in one line. */
  reason: string;
}

/** Why the builder holds a server's tools back, in one line. */
export function heldReason(s: McpServer): string {
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
export function refusedWhen(s: McpServer): "at admission" | "when it was approved" | "on a rescan" {
  if (!s.previous_pin) return "at admission";
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

/** The backend's rule for a server id (`SERVER_ID` in backend/app/mcp_registry.py). */
const ID = /^[a-z][a-z0-9_-]{0,62}$/;
/**
 * Ids the backend refuses: `server` (the platform's own MCP server answers at
 * /api/mcp/server, on the console) and the runtime's built-in servers, which
 * would answer in a registration's place (`BUILTIN_SERVERS`).
 */
export const RESERVED_IDS = ["server", "agents", "code", "documents", "engines", "events", "notify", "peers", "records", "retrieval", "sandbox", "spec", "store", "web"];
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

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
  if (f.transport === "stdio") {
    if (!f.command.trim()) return "Give the command line that starts the server.";
    const bad = lineNames(f.env, "=").find((l) => !l.split || !ENV_NAME.test(l.name));
    if (bad) return bad.split ? `"${bad.name}" is not an environment variable name.` : `"${bad.name}" needs a value: one KEY=VALUE per line.`;
    if (f.network.trim().toLowerCase() === "host") return "An isolated server never joins the host's network; name a network set up for it, or leave it blank for none.";
  } else {
    if (!/^https?:\/\/\S+$/i.test(f.url.trim())) return "Give the URL the server answers on, starting https://.";
    // The backend refuses userinfo in a URL (a URL ends up in logs); a credential belongs in a header, as a vault reference.
    if (/^https?:\/\/[^/\s?#]*@/i.test(f.url.trim())) return "A URL carries no credentials: put them in a header, ideally as a vault reference such as Authorization: Bearer ${secret:my-token}.";
    const bad = lineNames(f.headers, ":=").find((l) => !l.split || !HEADER_NAME.test(l.name));
    if (bad) return bad.split ? `"${bad.name}" is not a header name.` : `"${bad.name}" needs a value: one Name: value per line.`;
  }
  return "";
}
