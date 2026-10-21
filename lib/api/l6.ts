import { errorText, type Schemas } from "./client";
import type { RunRowL5 } from "./l5";

/**
 * The L6 doors (backend/CONTRACT.md, "L6: connect and contain", with its
 * "As built" notes), called by hand.
 *
 * The MCP registry door is in backend/openapi.json and so in the generated
 * lib/api/backend.d.ts (`listMcpServers`, `addMcpServer`,
 * `approveMcpServer`, `rescanMcpServer`, `deleteMcpServer`). The console's
 * shapes below take their enums from the generated schemas and are held to
 * them field by field (tests/l6-contract.test.ts: every field the console
 * names is the backend's, with a type the backend's admits), but the calls
 * stay plain fetches read by the mappings here, as lib/api/l5.ts does: a
 * refusal carries more than the generated client types (the screener's
 * hits and the refused server on a 422, the control on a 403 or a 503, the
 * field on a 400), and every answer is read defensively, so a renamed or
 * re-nested field fails the contract test instead of leaving a panel blank.
 * Every call is same-origin: proxy.ts forwards `/api/mcp` and all beneath
 * it to the backend, less the platform's own MCP server at
 * `/api/mcp/server`, which stays on the console (lib/route-policy.ts).
 *
 * Registering is admission, not trust: a server is started once, every tool
 * is screened, the tool list is pinned by digest, and nothing attaches to a
 * run until a person approves the pin. Env and header values never come
 * back from the backend; a server carries their names only, and so does
 * everything the console shows.
 */

/* ═══════════════════ the registry's shapes ═══════════════════ */

export type ServerStatus = Schemas["McpServer"]["status"];
export const SERVER_STATUSES: ServerStatus[] = ["pending", "approved", "refused", "changed"];

export type Transport = Schemas["McpServer"]["transport"];

/** One tool as the server listed it: what the screener read and the digest covers. */
export type PinnedTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** MCP's behaviour hints (readOnlyHint, destructiveHint, openWorldHint); they seed a binding's risk in the builder. */
  annotations?: Record<string, unknown>;
  /** A display title, when the server gave one. */
  title?: string;
};

/** The tool list a person approves, by its SHA-256 digest (`sha256:…`). */
export type Pin = {
  digest: string;
  tools: PinnedTool[];
  at: string;
};

export type HitField = Schemas["McpHit"]["field"];

/** One screener finding on one tool. A poisoned description is a hit. */
export type ScreenHit = {
  tool: string;
  field: HitField;
  /** The screener's control: `poisoning.concealment`, `injection.input`, `classifier.tool`, `modelarmor.tool.pi_and_jailbreak`, ... */
  control: string;
  detail: string;
};

/** What the server said it was when it was scanned (its `serverInfo`). */
export type ServerInfo = { name: string; version: string };

/** One discovery: when, who ran it, the digest of the list it found, what the screener said. */
export type Scan = {
  at: string;
  by: string;
  digest: string;
  hits: ScreenHit[];
  /** The server's own name and version, when it reported them. */
  server?: ServerInfo;
};

export type Approval = {
  by: string;
  at: string;
  /** The pin this approval approved; a later change of the list is read against it. */
  digest: string;
};

/** An entry written before L6, adopted by the registry on its first read: when, and from which record (`setting`, `mcp.json`). Never screened until it is approved. */
export type Adoption = { at: string; from: string };

/** A stdio server started in a container (runtime L6b), at discovery and at every run; absent fields are the runtime's defaults (no network). */
export type Isolation = { image?: string; network?: string };

/** A registered server, as `GET /api/mcp` lists it. */
export type McpServer = {
  id: string;
  label: string;
  transport: Transport;
  command?: string;
  args?: string[];
  /** HTTP: where it answers; a password in it arrives masked (`svc:***@`). */
  url?: string;
  /** Names only; the values stay in the registry. */
  env_names: string[];
  header_names: string[];
  version: string;
  status: ServerStatus;
  /** The list an approval admits. For a `changed` server it is the new list, waiting; the approved one is `previous_pin`. */
  pin: Pin | null;
  /** The pin a `changed` server, or one refused on a rescan, moved away from: the list that was approved. */
  previous_pin: Pin | null;
  last_scan: Scan | null;
  approvals: Approval[];
  /** The signature of whoever registered it, as the backend writes a signer; "" for an adopted entry. */
  added_by: string;
  added_at: string;
  adopted: Adoption | null;
  isolate: Isolation | null;
};

/** `GET /api/mcp` */
export type Registry = {
  servers: McpServer[];
  count: number;
  /** Approval needs a second person: whoever registered a server may not approve it. */
  two_person: boolean;
};

/** `POST /api/mcp`: a stdio server by its command line, or an HTTP one by its URL. */
export type NewServer = {
  label: string;
  id?: string;
  /** The shell line that starts it (stdio). */
  command?: string;
  /** Where it answers (HTTP). */
  url?: string;
  env?: Record<string, string> | string;
  headers?: Record<string, string> | string;
  version?: string;
  /** stdio only: start it in a container, at discovery and at every run. */
  isolate?: Isolation;
};

/** `POST /api/mcp/{id}/rescan` */
export type Rescan = {
  server: McpServer;
  /** The list found is not the one the server was pinned on: a clean one leaves it `changed` and detached until approved again; a poisoned one, `refused`. */
  changed: boolean;
};

/* ═══════════════════ mapping ═══════════════════ */

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v === null || v === undefined ? d : String(v));
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const isObj = (v: unknown): boolean => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export function toolOf(v: unknown): PinnedTool | null {
  const t = obj(v);
  const name = str(t.name);
  if (!name) return null;
  const annotations = obj(t.annotations);
  return {
    name,
    description: str(t.description),
    inputSchema: Object.keys(obj(t.inputSchema)).length ? obj(t.inputSchema) : { type: "object" },
    ...(Object.keys(annotations).length ? { annotations } : {}),
    ...(typeof t.title === "string" && t.title ? { title: t.title } : {}),
  };
}

export function pinOf(v: unknown): Pin | null {
  if (!isObj(v)) return null;
  const p = obj(v);
  return {
    digest: str(p.digest),
    tools: (Array.isArray(p.tools) ? p.tools : []).map(toolOf).filter((t): t is PinnedTool => t !== null),
    at: str(p.at),
  };
}

export function hitOf(v: unknown): ScreenHit {
  const h = obj(v);
  const field = h.field === "name" || h.field === "schema" ? h.field : "description";
  return { tool: str(h.tool), field, control: str(h.control, "screener") || "screener", detail: str(h.detail) };
}

export function scanOf(v: unknown): Scan | null {
  if (!isObj(v)) return null;
  const s = obj(v);
  const info = obj(s.server);
  const server = str(info.name) || str(info.version) ? { server: { name: str(info.name), version: str(info.version) } } : {};
  return { at: str(s.at), by: str(s.by), digest: str(s.digest), hits: (Array.isArray(s.hits) ? s.hits : []).map(hitOf), ...server };
}

function approvalOf(v: unknown): Approval {
  const a = obj(v);
  return { by: str(a.by), at: str(a.at), digest: str(a.digest) };
}

function adoptionOf(v: unknown): Adoption | null {
  if (!isObj(v)) return null;
  const a = obj(v);
  return { at: str(a.at), from: str(a.from) };
}

/** The registration's `isolate`, the fields the console reads; `{}` is isolated on the runtime's defaults. */
export function isolationOf(v: unknown): Isolation | null {
  if (!isObj(v)) return null;
  const i = obj(v);
  return { ...(str(i.image) ? { image: str(i.image) } : {}), ...(str(i.network) ? { network: str(i.network) } : {}) };
}

/**
 * A server row, normalised. Every field the console reads is present; what
 * the backend omits is defaulted here. A value that arrives under `env` or
 * `headers` is never kept, only its name.
 */
export function serverOf(v: unknown): McpServer {
  const s = obj(v);
  const status = SERVER_STATUSES.find((x) => x === s.status) ?? "pending";
  const transport: Transport = s.transport === "http" || (!s.command && typeof s.url === "string" && s.url) ? "http" : "stdio";
  const names = (list: unknown, map: unknown) => (strs(list).length ? strs(list) : Object.keys(obj(map)));
  return {
    id: str(s.id),
    label: str(s.label) || str(s.id),
    transport,
    ...(typeof s.command === "string" && s.command ? { command: s.command } : {}),
    ...(Array.isArray(s.args) ? { args: strs(s.args) } : {}),
    ...(typeof s.url === "string" && s.url ? { url: s.url } : {}),
    env_names: names(s.env_names, s.env),
    header_names: names(s.header_names, s.headers),
    version: str(s.version),
    status,
    pin: pinOf(s.pin),
    previous_pin: pinOf(s.previous_pin),
    last_scan: scanOf(s.last_scan),
    approvals: (Array.isArray(s.approvals) ? s.approvals : []).map(approvalOf),
    added_by: str(s.added_by),
    added_at: str(s.added_at),
    adopted: adoptionOf(s.adopted),
    isolate: isolationOf(s.isolate),
  };
}

export function registryOf(v: unknown): Registry {
  const o = obj(v);
  const servers = (Array.isArray(o.servers) ? o.servers : []).map(serverOf).filter((s) => s.id);
  return { servers, count: typeof o.count === "number" ? o.count : servers.length, two_person: o.two_person === true };
}

/* ═══════════════════ the add form, as the contract's body ═══════════════════ */

/** What the add form holds; `addBody` turns it into the contract's request. */
export interface AddForm {
  label: string;
  /** Optional: the backend derives one from the label when blank. */
  id: string;
  transport: Transport;
  /** stdio: the line that starts it. */
  command: string;
  /** http: where it answers. */
  url: string;
  /** stdio: KEY=VALUE lines. */
  env: string;
  /** http: `Name: value` lines. */
  headers: string;
  version: string;
  /** stdio, optional: the container image to start it in (`isolate.image`). */
  image: string;
  /** stdio, optional: the network that container joins (`isolate.network`); none when blank. */
  network: string;
}

export const EMPTY_FORM: AddForm = { label: "", id: "", transport: "stdio", command: "", url: "", env: "", headers: "", version: "", image: "", network: "" };

/**
 * KEY=VALUE lines as a map. Blank lines and `#` comments are skipped; a line
 * splits at the first of the separators it contains, so a value may carry
 * the other (`Authorization: Bearer ${secret:key}`, `X-Key=${secret:a:b}`).
 */
export function kvLines(text: string, separators = "="): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    let at = -1;
    for (const sep of separators) {
      const i = t.indexOf(sep);
      if (i > 0 && (at === -1 || i < at)) at = i;
    }
    if (at <= 0) continue;
    const key = t.slice(0, at).trim();
    if (key) out[key] = t.slice(at + 1).trim();
  }
  return out;
}

/**
 * The contract's `POST /api/mcp` body from the form. A stdio server sends
 * its command line, its environment and, when asked, the container it runs
 * in; an HTTP server its URL and its headers. Blank optional fields are
 * left out rather than sent empty.
 */
export function addBody(f: AddForm): NewServer {
  const body: NewServer = { label: f.label.trim() };
  if (f.id.trim()) body.id = f.id.trim();
  if (f.transport === "stdio") {
    body.command = f.command.trim();
    const env = kvLines(f.env);
    if (Object.keys(env).length) body.env = env;
    const image = f.image.trim();
    const network = f.network.trim();
    if (image || network) body.isolate = { ...(image ? { image } : {}), ...(network ? { network } : {}) };
  } else {
    body.url = f.url.trim();
    const headers = kvLines(f.headers, ":=");
    if (Object.keys(headers).length) body.headers = headers;
  }
  if (f.version.trim()) body.version = f.version.trim();
  return body;
}

/* ═══════════════════ calls ═══════════════════ */

/** One request to the registry door: what is sent, before it is sent. */
export interface RegistryRequest {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
}

const at = (id: string) => `/api/mcp/${encodeURIComponent(id)}`;

/** The registry door's requests, by action. Approve and rescan carry no body. */
export const REGISTRY = {
  list: (): RegistryRequest => ({ method: "GET", path: "/api/mcp" }),
  add: (body: NewServer): RegistryRequest => ({ method: "POST", path: "/api/mcp", body }),
  approve: (id: string): RegistryRequest => ({ method: "POST", path: `${at(id)}/approve` }),
  rescan: (id: string): RegistryRequest => ({ method: "POST", path: `${at(id)}/rescan` }),
  remove: (id: string): RegistryRequest => ({ method: "DELETE", path: at(id) }),
};

/**
 * A refusal from the registry door, with what the console shows for it:
 * the status, the control the backend named (`screener` on a 422 with the
 * hits that refused admission or approval, `two_person` on a 403 when the
 * approver is the one who registered the server, `screener.unavailable` on
 * a 503 when the screener could not judge), the hits themselves, the field
 * a 400 names, and the server a 422 stored as refused.
 */
export class RegistryError extends Error {
  readonly status: number;
  readonly control: string;
  readonly hits: ScreenHit[];
  readonly field: string;
  readonly server: McpServer | null;
  constructor(message: string, status: number, control = "", hits: ScreenHit[] = [], field = "", server: McpServer | null = null) {
    super(message);
    this.name = "RegistryError";
    this.status = status;
    this.control = control;
    this.hits = hits;
    this.field = field;
    this.server = server;
  }
}

/**
 * A URL's password, masked as the registry masks it in a server's `url`
 * (`https://svc:***@host`). A discovery failure says the URL it could not
 * reach back as it was typed, password and all; the console never shows it.
 */
export function maskUrlPasswords(text: string): string {
  return text.replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s/?#@:]*):[^\s/?#@]*@/gi, "$1:***@");
}

/**
 * The error a non-2xx answer becomes. A page (Next's own 404, a proxy's
 * 502) is no message at all, and a bare 404, 502 or 503 means no backend
 * answered the door.
 */
export function registryErrorOf(status: number, body: unknown, statusText = ""): RegistryError {
  const o = obj(body);
  const page = typeof body === "string" && body.trimStart().startsWith("<");
  let message = maskUrlPasswords(errorText(page ? null : body, { status, statusText }));
  if (/answered (404|502|503)/.test(message)) message = `${message}: the MCP registry is served by the backend; this deployment may not have named it (BACKEND_ORIGIN)`;
  const server = isObj(o.server) ? serverOf(o.server) : null;
  return new RegistryError(message, status, str(o.control), (Array.isArray(o.hits) ? o.hits : []).map(hitOf), str(o.field), server && server.id ? server : null);
}

async function call<T>(req: RegistryRequest, parse: (v: unknown) => T): Promise<T> {
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
  if (!res.ok) throw registryErrorOf(res.status, json ?? text, res.statusText);
  return parse(json);
}

/** `GET /api/mcp`: every registered server with its status, pin and last scan. */
export async function listServers(): Promise<Registry> {
  return call(REGISTRY.list(), registryOf);
}

/** `POST /api/mcp`: 201 with the server, left `pending`; a 422 carries the screener's hits and the server stored as refused, a 502 the discovery error, a 503 a screener that could not judge. */
export async function addServer(body: NewServer): Promise<McpServer> {
  return call(REGISTRY.add(body), (j) => serverOf(obj(j).server ?? j));
}

/** `POST /api/mcp/{id}/approve`: the pin is approved and the server attaches to runs. An adopted entry is screened first: a 422 and it is refused. */
export async function approveServer(id: string): Promise<McpServer> {
  return call(REGISTRY.approve(id), (j) => serverOf(obj(j).server ?? j));
}

/** `POST /api/mcp/{id}/rescan`: discovers again; `changed` when the list no longer matches the pin. */
export async function rescanServer(id: string): Promise<Rescan> {
  return call(REGISTRY.rescan(id), (j) => ({ server: serverOf(obj(j).server ?? j), changed: obj(j).changed === true }));
}

/** `DELETE /api/mcp/{id}`: 204. */
export async function deleteServer(id: string): Promise<void> {
  await call(REGISTRY.remove(id), () => undefined);
}

/* ═══════════════════ runs from the SDK door ═══════════════════ */

/**
 * Where a run came from, in the backend's vocabulary (`app.ledger.source_of`,
 * the one definition the ledger, the inbox and the links share): the
 * console, a worker that claimed it from the queue, an attached agent's SDK,
 * A2A, or an application through the model gateway. A record may name
 * something else of its own; it is passed through as it is.
 */
export type RunSource = "console" | "worker" | "sdk" | "a2a" | "gateway";

/** `GET /api/runs` rows. `source` is on the generated row since L6; the alias stays for the pages that name it. */
export type RunRowL6 = RunRowL5;

/**
 * A run's source, from a ledger row or a run record, read the way the
 * backend's `source_of` reads it: the door that reported it
 * (`reported_by.mode`, which the SDK, A2A and gateway doors stamp), else
 * the `source` the row or record names, else `worker` for a run a worker
 * claimed from the queue (`job`, `worker`); "" when nothing says, which is
 * a run the platform started itself. A ledger row carries `source` only,
 * already decided.
 */
export function runSourceOf(v: unknown): string {
  const o = obj(v);
  const mode = str(obj(o.reported_by).mode);
  if (mode) return mode;
  if (typeof o.source === "string" && o.source) return o.source;
  if (o.job || o.worker) return "worker";
  return "";
}

/** Whether a run was opened by an attached agent's SDK (`POST /api/sdk/runs`). */
export function isSdkRun(v: unknown): boolean {
  return runSourceOf(v) === "sdk";
}
