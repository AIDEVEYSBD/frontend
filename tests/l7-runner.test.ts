import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The eval runner (app/api/evals/run/route.ts) meets a rate limit (phase
 * L7): a case's `POST /api/runs` answered 429 is not a failed case. The
 * stream says so (`rate_limited`, with the scope, the limit, the figures and
 * the wait), the runner waits the time the backend gave and starts the case
 * again; refused past its retries, the case is recorded as refused, naming
 * the limit. The 429 body is the one captured from the backend's runs door
 * (tests/l7-contract.test.ts `runs_429_agent`), its wait shortened to a
 * second so the test waits it out for real.
 */

const RATE_LIMITED = {
  error: "rate limit: 2 runs started for tiny in the last minute, 2 allowed (run_starts_per_minute); retry in 1s",
  control: "rate_limit",
  scope: "agent",
  limit: "run_starts_per_minute",
  used: 2,
  allowed: 2,
  retry_after_s: 1,
  agent: "tiny",
  tree: "t-dccf0d813751489e",
  kind: "start",
};

const SET = { id: "smoke", agent: "tiny", name: "Smoke", cases: [{ id: "c1", input: { case: "C-1" }, checks: [] }] };

vi.mock("@/lib/server/auth", () => ({ permit: vi.fn(async () => null) }));
vi.mock("@/lib/server/db", () => ({ dbReady: vi.fn(async () => false), query: vi.fn(async () => []) }));
vi.mock("@/lib/server/evals", async (orig) => ({ ...(await orig<typeof import("@/lib/server/evals")>()), loadSet: vi.fn(async () => SET) }));

const answers: Response[] = [];
const asked: string[] = [];
vi.mock("@/lib/server/backend", () => ({
  backendConfigured: () => true,
  backendMissing: () => Response.json({ error: "no backend" }, { status: 503 }),
  backendError: async (res: Response) => ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "refused",
  backendFetch: vi.fn(async (_req: Request, path: string, init: RequestInit = {}) => {
    asked.push(`${init.method ?? "GET"} ${path}`);
    const next = answers.shift();
    if (!next) throw new Error(`no answer left for ${path}`);
    return next;
  }),
}));

import { POST } from "@/app/api/evals/run/route";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

async function events(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((part) => part.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(6)));
}

afterEach(() => {
  vi.useRealTimers();
  answers.length = 0;
  asked.length = 0;
});

describe("the eval runner and a rate limit", () => {
  it("waits the time the backend gave, says so, and starts the case again", async () => {
    answers.push(
      json(200, { spec: { apiVersion: "agentfactory/v1", kind: "AgentSystem", metadata: { id: "tiny" }, spec: { nodes: [] } } }),
      json(429, RATE_LIMITED, { "retry-after": "1" }),
      json(201, { run: "tiny-r1", state: "running" }),
      json(200, { id: "tiny-r1", state: "done", result: { verdict: "benign" }, journal: { entries: [] } }),
    );
    const started = Date.now();
    const res = await POST(new Request("http://console.test/api/evals/run", { method: "POST", body: JSON.stringify({ set_id: "smoke" }) }));
    const evs = await events(res);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(asked).toEqual(["GET /api/agents/tiny", "POST /api/runs", "POST /api/runs", "GET /api/runs/tiny-r1"]);
    const limited = evs.find((e) => e.type === "rate_limited")!;
    expect(limited).toMatchObject({ index: 0, id: "c1", attempt: 1, of: 5, wait_s: 1, limit: { scope: "agent", limit: "run_starts_per_minute", used: 2, allowed: 2, retry_after_s: 1, agent: "tiny" } });
    expect(limited.text).toBe("Rate limited for agent tiny: runs started per minute, 2 used of 2 allowed (run_starts_per_minute). Retry in 1 s.");
    expect(evs.find((e) => e.type === "case.done")).toMatchObject({ id: "c1", state: "done", run_file: "tiny-r1", passed: true });
  });

  it("refused past its retries, the case is recorded as refused, naming the limit", async () => {
    answers.push(json(200, { spec: { metadata: { id: "tiny" }, spec: { nodes: [] } } }));
    // Six refusals: the first start and five retries, each a second apart, on a clock the test moves.
    for (let i = 0; i < 6; i++) answers.push(json(429, RATE_LIMITED, { "retry-after": "1" }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const read: { evs: Record<string, unknown>[] | null } = { evs: null };
    const res = await POST(new Request("http://console.test/api/evals/run", { method: "POST", body: JSON.stringify({ set_id: "smoke" }) }));
    const reading = events(res).then((e) => (read.evs = e));
    for (let tick = 0; tick < 20 && !read.evs; tick++) await vi.advanceTimersByTimeAsync(1000);
    await reading;
    vi.useRealTimers();
    const evs = read.evs;
    if (!evs) throw new Error("the runner never finished");
    expect(evs.filter((e) => e.type === "rate_limited").map((e) => e.attempt)).toEqual([1, 2, 3, 4, 5]);
    const done = evs.find((e) => e.type === "case.done")!;
    expect(done).toMatchObject({ id: "c1", state: "failed", passed: false, run_file: "" });
    expect(done.error).toBe("refused at the start, past 5 retries: Rate limited for agent tiny: runs started per minute, 2 used of 2 allowed (run_starts_per_minute). Retry in 1 s.");
  });
});
