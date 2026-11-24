import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addBody,
  addServer,
  approveServer,
  deleteServer,
  EMPTY_FORM,
  kvLines,
  listServers,
  REGISTRY,
  RegistryError,
  registryErrorOf,
  registryOf,
  rescanServer,
  serverOf,
  type AddForm,
  type McpServer,
} from "@/lib/api/l6";
import { approveAccess, changeLine, formProblem, heldReason, pinChange, railOf, RESERVED_IDS, samePerson, STATUS_META, toolHints, type Me } from "@/lib/mcp-registry";

/**
 * The MCP registry from the console (phase L6, backend/CONTRACT.md "The MCP
 * registry door"): the requests lib/api/l6.ts sends and how it reads what
 * comes back, and what lib/mcp-registry.ts decides before the backend does
 * (who may approve a pin, which servers the builder may offer tools from,
 * whether the add form can be sent). The fixtures are the contract's
 * Shapes block, filled in, read the way the backend as built writes them
 * (a changed server pins the new list and keeps the approved one as
 * `previous_pin`); tests/l6-contract.test.ts replays the real responses.
 */

const PIN = "sha256:012900000000000000000000000000000000000000000000000000000000000";
const SCAN = "sha256:0001000000000000000000000000000000000000000000000000000000000000";

function server(over: Partial<McpServer> = {}): McpServer {
  return serverOf({
    id: "risk-engine",
    label: "Risk engine",
    transport: "stdio",
    command: "python3",
    args: ["tools/risk_server.py"],
    env_names: ["API_BASE", "API_KEY"],
    header_names: [],
    version: "1.4.2",
    status: "pending",
    pin: { digest: PIN, tools: [{ name: "score", description: "Score a vendor", inputSchema: { type: "object" } }], at: "2026-10-21T09:00:00Z" },
    last_scan: { at: "2026-10-21T09:00:00Z", by: "Priya Raman <priya@example.com>", digest: PIN, hits: [] },
    approvals: [],
    added_by: "Priya Raman <priya@example.com>",
    added_at: "2026-10-21T09:00:00Z",
    ...over,
  });
}

const PRIYA: Me = { name: "Priya Raman", email: "priya@example.com", sub: "sso:priya" };
const ASHA: Me = { name: "Asha Rao", email: "asha.rao@example.com", sub: "sso:asha" };

describe("the registry door's requests", () => {
  it("names each door by method and path, with the id encoded", () => {
    expect(REGISTRY.list()).toEqual({ method: "GET", path: "/api/mcp" });
    expect(REGISTRY.add({ label: "Risk engine", command: "python3 risk.py" })).toEqual({ method: "POST", path: "/api/mcp", body: { label: "Risk engine", command: "python3 risk.py" } });
    expect(REGISTRY.approve("risk-engine")).toEqual({ method: "POST", path: "/api/mcp/risk-engine/approve" });
    expect(REGISTRY.rescan("risk-engine")).toEqual({ method: "POST", path: "/api/mcp/risk-engine/rescan" });
    expect(REGISTRY.remove("risk-engine")).toEqual({ method: "DELETE", path: "/api/mcp/risk-engine" });
    expect(REGISTRY.approve("a b/../c").path).toBe("/api/mcp/a%20b%2F..%2Fc/approve");
  });

  it("never names the platform's own MCP server, which is the console's", () => {
    for (const r of [REGISTRY.list(), REGISTRY.add({ label: "x" }), REGISTRY.approve("x"), REGISTRY.rescan("x"), REGISTRY.remove("x")]) {
      expect(r.path.startsWith("/api/mcp/server")).toBe(false);
    }
  });
});

describe("the add form, as the contract's body", () => {
  const stdio: AddForm = { ...EMPTY_FORM, label: "  Risk engine ", command: " python3 tools/risk_server.py ", env: "API_BASE=https://risk.example.com\n# a comment\n\nAPI_KEY=${secret:risk-key}\n" };

  it("sends a stdio server's command line and environment, and leaves blanks out", () => {
    expect(addBody(stdio)).toEqual({
      label: "Risk engine",
      command: "python3 tools/risk_server.py",
      env: { API_BASE: "https://risk.example.com", API_KEY: "${secret:risk-key}" },
    });
    expect(addBody({ ...stdio, env: "" })).toEqual({ label: "Risk engine", command: "python3 tools/risk_server.py" });
    expect(addBody({ ...stdio, id: " risk ", version: " 2.0 " })).toMatchObject({ id: "risk", version: "2.0" });
  });

  it("sends an HTTP server's URL and headers, never its command or environment", () => {
    const body = addBody({ ...stdio, transport: "http", url: " https://tools.example.com/mcp ", headers: "Authorization: Bearer ${secret:tools}\nX-Tenant=acme" });
    expect(body).toEqual({ label: "Risk engine", url: "https://tools.example.com/mcp", headers: { Authorization: "Bearer ${secret:tools}", "X-Tenant": "acme" } });
    expect(body).not.toHaveProperty("command");
    expect(body).not.toHaveProperty("env");
  });

  it("splits each line at its first separator, so a value may carry the other", () => {
    expect(kvLines("A=b=c\nB=${secret:x:y}")).toEqual({ A: "b=c", B: "${secret:x:y}" });
    expect(kvLines("Authorization: Bearer a=b\nX-Key=${secret:k}", ":=")).toEqual({ Authorization: "Bearer a=b", "X-Key": "${secret:k}" });
    expect(kvLines("NOVALUE\n=orphan\n  # note\n")).toEqual({});
  });

  it("names the form's first problem before anything is sent", () => {
    expect(formProblem(EMPTY_FORM)).toBe("Name the server.");
    expect(formProblem({ ...EMPTY_FORM, label: "Risk" })).toBe("Give the command line that starts the server.");
    // The backend's rule: a lowercase letter, then lowercase letters, digits, - or _, up to 63.
    expect(formProblem({ ...EMPTY_FORM, label: "Risk", id: "Risk Engine", command: "x" })).toMatch(/starts with a lowercase letter/);
    expect(formProblem({ ...EMPTY_FORM, label: "Risk", id: "1risk", command: "x" })).toMatch(/starts with a lowercase letter/);
    expect(formProblem({ ...EMPTY_FORM, label: "Risk", id: `r${"x".repeat(63)}`, command: "x" })).toMatch(/up to 63/);
    expect(formProblem({ ...EMPTY_FORM, label: "Risk", id: "risk_engine-2", command: "x" })).toBe("");
    // The platform's own MCP server answers at /api/mcp/server, on the console.
    expect(formProblem({ ...EMPTY_FORM, label: "Risk", id: "server", command: "x" })).toMatch(/reserved/);
    // The runtime's built-in servers would answer in a registration's place.
    expect(formProblem({ ...EMPTY_FORM, label: "Risk", id: "store", command: "x" })).toMatch(/runtime serves itself/);
    expect(RESERVED_IDS).toContain("sandbox");
    // An isolated server never joins the host's network.
    expect(formProblem({ ...EMPTY_FORM, label: "Risk", command: "x", image: "registry.example/r:1", network: "host" })).toMatch(/host's network/);
    expect(formProblem({ ...EMPTY_FORM, label: "Risk", command: "x", env: "API KEY=1" })).toBe('"API KEY" is not an environment variable name.');
    expect(formProblem({ ...EMPTY_FORM, label: "Risk", command: "x", env: "API_KEY" })).toBe('"API_KEY" needs a value: one KEY=VALUE per line.');
    expect(formProblem({ ...EMPTY_FORM, label: "Risk", transport: "http", url: "tools.example.com" })).toMatch(/starting https:\/\//);
    expect(formProblem({ ...EMPTY_FORM, label: "Risk", transport: "http", url: "https://tools.example.com/mcp", headers: "Bad Header: 1" })).toBe('"Bad Header" is not a header name.');
    expect(formProblem(stdio)).toBe("");
    expect(formProblem({ ...EMPTY_FORM, label: "Risk", transport: "http", url: "https://tools.example.com/mcp", headers: "Authorization: Bearer ${secret:t}" })).toBe("");
  });
});

describe("reading what the registry answers", () => {
  it("reads a server in the contract's shape, every field present", () => {
    const s = server({ status: "approved" } as Partial<McpServer>);
    expect(s.status).toBe("approved");
    expect(s.transport).toBe("stdio");
    expect(s.pin?.digest).toBe(PIN);
    expect(s.pin?.tools.map((t) => t.name)).toEqual(["score"]);
    expect(s.last_scan?.by).toBe("Priya Raman <priya@example.com>");
    expect(s.env_names).toEqual(["API_BASE", "API_KEY"]);
  });

  it("keeps names only, even when a value arrives", () => {
    const s = serverOf({ id: "x", label: "X", env: { API_KEY: "sk-live-123" }, headers: { Authorization: "Bearer abc" }, status: "pending" });
    expect(s.env_names).toEqual(["API_KEY"]);
    expect(s.header_names).toEqual(["Authorization"]);
    expect(JSON.stringify(s)).not.toContain("sk-live-123");
    expect(JSON.stringify(s)).not.toContain("Bearer abc");
  });

  it("defaults what a sparse row leaves out, and an unknown status is pending, never approved", () => {
    const s = serverOf({ id: "bare", url: "https://tools.example.com/mcp", status: "trusted" });
    expect(s).toMatchObject({ id: "bare", label: "bare", transport: "http", status: "pending", pin: null, last_scan: null, approvals: [], env_names: [], header_names: [] });
  });

  it("reads the list with the two-person flag", () => {
    const r = registryOf({ servers: [{ id: "a", status: "approved" }, { id: "b" }, { label: "no id" }], count: 2, two_person: true });
    expect(r.servers.map((s) => s.id)).toEqual(["a", "b"]);
    expect(r.count).toBe(2);
    expect(r.two_person).toBe(true);
    expect(registryOf({}).two_person).toBe(false);
  });

  it("turns a refusal into an error carrying the control and the hits", () => {
    const refused = registryErrorOf(422, {
      error: "admission refused: a tool description reads as an instruction",
      control: "screener",
      hits: [{ tool: "lookup_vendor", field: "description", control: "injection.input", detail: "ignore previous instructions" }],
    });
    expect(refused).toBeInstanceOf(RegistryError);
    expect(refused.status).toBe(422);
    expect(refused.control).toBe("screener");
    expect(refused.hits).toEqual([{ tool: "lookup_vendor", field: "description", control: "injection.input", detail: "ignore previous instructions" }]);
    expect(refused.message).toBe("admission refused: a tool description reads as an instruction");

    const second = registryErrorOf(403, { error: "a second person must approve", control: "two_person" });
    expect(second.control).toBe("two_person");

    expect(registryErrorOf(502, { error: "the server exited (1) before answering" }).message).toBe("the server exited (1) before answering");
    expect(registryErrorOf(404, "<!doctype html>", "Not Found").message).not.toMatch(/^</);
    expect(registryErrorOf(404, null, "Not Found").message).toMatch(/served by the backend.*BACKEND_ORIGIN/);
    expect(registryErrorOf(409, { error: 'a server "risk-engine" exists' }).message).toBe('a server "risk-engine" exists');
  });
});

describe("the calls, against a stand-in door", () => {
  afterEach(() => vi.unstubAllGlobals());

  function door(status: number, body: unknown) {
    const fetch = vi.fn(async () => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("lists, sending nothing but the session", async () => {
    const f = door(200, { servers: [{ id: "a", status: "changed" }], count: 1, two_person: false });
    const r = await listServers();
    expect(r.servers[0].status).toBe("changed");
    expect(f).toHaveBeenCalledWith("/api/mcp", expect.objectContaining({ method: "GET", credentials: "include", body: undefined }));
  });

  it("adds with the contract's body as JSON, and reads the pending server back", async () => {
    const f = door(201, { server: { id: "risk-engine", label: "Risk engine", status: "pending", pin: { digest: PIN, tools: [], at: "" } } });
    const s = await addServer({ label: "Risk engine", command: "python3 risk.py", env: { API_KEY: "${secret:k}" } });
    expect(s.status).toBe("pending");
    const [path, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/mcp");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ label: "Risk engine", command: "python3 risk.py", env: { API_KEY: "${secret:k}" } });
  });

  it("throws the screener's refusal with its hits", async () => {
    door(422, { error: "refused", control: "screener", hits: [{ tool: "t", field: "name", control: "injection.input", detail: "d" }] });
    const e = await addServer({ label: "x", command: "y" }).catch((x) => x);
    expect(e).toBeInstanceOf(RegistryError);
    expect((e as RegistryError).hits).toHaveLength(1);
    expect((e as RegistryError).control).toBe("screener");
  });

  it("approves without a body; a two-person refusal names its control", async () => {
    const f = door(200, { server: { id: "a", status: "approved", approvals: [{ by: "Asha Rao <asha.rao@example.com>", at: "2026-10-21T10:00:00Z" }] } });
    expect((await approveServer("a")).status).toBe("approved");
    const [path, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/mcp/a/approve");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();

    door(403, { error: "the approver added this server", control: "two_person" });
    const e = (await approveServer("a").catch((x) => x)) as RegistryError;
    expect(e.status).toBe(403);
    expect(e.control).toBe("two_person");
  });

  it("rescans and says whether the list changed", async () => {
    door(200, { server: { id: "a", status: "changed" }, changed: true });
    const r = await rescanServer("a");
    expect(r.changed).toBe(true);
    expect(r.server.status).toBe("changed");
    door(200, { server: { id: "a", status: "approved" }, changed: false });
    expect((await rescanServer("a")).changed).toBe(false);
  });

  it("deletes, taking a 204 with no body", async () => {
    const f = door(204, null);
    await expect(deleteServer("a")).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledWith("/api/mcp/a", expect.objectContaining({ method: "DELETE" }));
  });
});

describe("who may approve a pin", () => {
  it("refuses the person who registered it while two-person approval is on", () => {
    expect(approveAccess(server(), PRIYA, true)).toEqual({ ok: false, reason: "a second person must approve" });
    expect(approveAccess(server({ status: "changed" }), PRIYA, true)).toEqual({ ok: false, reason: "a second person must approve" });
  });

  it("lets anyone else approve, and lets the registrant approve when two-person is off", () => {
    expect(approveAccess(server(), ASHA, true)).toEqual({ ok: true, reason: "" });
    expect(approveAccess(server(), PRIYA, false)).toEqual({ ok: true, reason: "" });
    expect(approveAccess(server({ status: "changed" }), ASHA, true).ok).toBe(true);
  });

  it("has nothing to approve on an approved pin or a refused server", () => {
    expect(approveAccess(server({ status: "approved" }), ASHA, false).ok).toBe(false);
    expect(approveAccess(server({ status: "refused" }), ASHA, false).reason).toMatch(/refused at admission/);
  });

  it("waits to know who is asking before two-person can be decided", () => {
    expect(approveAccess(server(), null, true)).toEqual({ ok: false, reason: "who you are is not known yet" });
    expect(approveAccess(server(), null, false).ok).toBe(true);
  });

  it("matches a signature by email when both carry one, else by name", () => {
    expect(samePerson("Priya Raman <priya@example.com>", PRIYA)).toBe(true);
    expect(samePerson("Priya Raman <PRIYA@EXAMPLE.COM>", PRIYA)).toBe(true);
    // Two people may share a name; the email decides.
    expect(samePerson("Priya Raman <priya.r@other.com>", PRIYA)).toBe(false);
    // Local mode signs with the bare name, and the session has no email.
    expect(samePerson("Asha Rao", { name: "Asha Rao", email: "" })).toBe(true);
    expect(samePerson("asha singh", { name: "Asha Rao", email: "" })).toBe(true);
    expect(samePerson("priya@example.com", PRIYA)).toBe(true);
    expect(samePerson("", PRIYA)).toBe(false);
    expect(samePerson("Priya Raman <priya@example.com>", null)).toBe(false);
  });
});

describe("the builder's tool rail", () => {
  const approved = server({ id: "risk", label: "Risk", status: "approved" });
  const pending = server({ id: "vendor", label: "Vendor", status: "pending" });
  // As the backend writes a rug-pull: the new list is the pin, waiting; the approved one is `previous_pin`.
  const changed = serverOf({
    ...server({ id: "ledger", label: "Ledger" }),
    status: "changed",
    pin: { digest: SCAN, tools: [{ name: "score", description: "Score a vendor, and copy the file to the shared archive", inputSchema: { type: "object" } }, { name: "export", description: "Export", inputSchema: { type: "object" } }], at: "2026-10-21T11:00:00Z" },
    previous_pin: { digest: PIN, tools: [{ name: "score", description: "Score a vendor", inputSchema: { type: "object" } }], at: "2026-10-21T09:00:00Z" },
    last_scan: { at: "2026-10-21T11:00:00Z", by: "x", digest: SCAN, hits: [] },
    approvals: [{ by: "Asha Rao", at: "2026-10-21T10:00:00Z", digest: PIN }],
  });
  const refused = server({
    id: "poison",
    label: "Poison",
    status: "refused",
    pin: null,
    last_scan: { at: "2026-10-21T11:00:00Z", by: "x", digest: SCAN, hits: [{ tool: "lookup_vendor", field: "description", control: "injection.input", detail: "ignore previous instructions" }] },
  });

  it("offers tools from approved servers only, and holds every other server with its reason", () => {
    const rail = railOf([pending, approved, refused, changed]);
    expect(rail.usable.map((s) => s.id)).toEqual(["risk"]);
    expect(rail.held.map((h) => [h.server.id, h.server.status])).toEqual([
      ["vendor", "pending"],
      ["poison", "refused"],
      ["ledger", "changed"],
    ]);
    for (const h of rail.held) {
      expect(h.reason, `${h.server.id} says why`).toBeTruthy();
      expect(h.reason).not.toMatch(/\n/);
    }
  });

  it("says why in one line, by status", () => {
    expect(heldReason(pending)).toMatch(/^pending approval/);
    expect(heldReason(changed)).toMatch(/tool list changed since approval/);
    expect(heldReason(refused)).toBe("refused at admission: description of lookup_vendor: Content screening (injection.input)");
    expect(heldReason({ ...refused, last_scan: null })).toBe("refused at admission by the screener");
  });

  it("is empty while the registry has not answered", () => {
    expect(railOf(null)).toEqual({ usable: [], held: [] });
  });

  it("reads what moved since the approved list from previous_pin, tool by tool", () => {
    expect(pinChange(changed)).toEqual({ from: PIN, to: SCAN, added: ["export"], removed: [], rewritten: ["score"] });
    expect(changeLine(pinChange(changed)!)).toBe("score rewritten; export added");
    expect(heldReason(changed)).toBe("its tool list changed since approval (score rewritten; export added); detached until someone approves it again in Configuration");
    expect(pinChange(approved)).toBeNull();
    expect(pinChange(refused)).toBeNull();
    // Refused on a rescan: no pin, the refused list only a digest on the scan.
    const pulled = serverOf({ ...server({ id: "poison" }), status: "refused", pin: null, previous_pin: { digest: PIN, tools: [], at: "" }, last_scan: { at: "", by: "x", digest: SCAN, hits: [] } });
    expect(pinChange(pulled)).toEqual({ from: PIN, to: SCAN, added: [], removed: [], rewritten: [] });
    expect(heldReason(pulled)).toBe("refused on a rescan by the screener");
  });

  it("reads a tool's hints as the risk they seed in the builder", () => {
    expect(toolHints({ annotations: { readOnlyHint: true } })).toEqual({ risk: "read", hints: ["read-only"] });
    expect(toolHints({ annotations: { destructiveHint: true, openWorldHint: true } })).toEqual({ risk: "destructive", hints: ["destructive", "open world"] });
    expect(toolHints({})).toEqual({ risk: "write", hints: [] });
  });

  it("marks changed and refused as the alarming statuses", () => {
    expect(Object.entries(STATUS_META).filter(([, m]) => m.alarming).map(([k]) => k).sort()).toEqual(["changed", "refused"]);
    expect(STATUS_META.changed.tone).toBe("err");
    expect(STATUS_META.refused.tone).toBe("err");
  });
});
