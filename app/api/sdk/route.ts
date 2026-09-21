import { ENDPOINTS, LANGUAGES, RECORDED } from "@/lib/attached";

/**
 * The SDK, described. What an agent's SDK talks to, in what shape, and what
 * the factory records from it — so a person configuring an agent, or a curl
 * during a walkthrough, gets the contract rather than a 404.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    sdk: { name: "agentfactory", version: "1.4.0" },
    packages: LANGUAGES.map((l) => ({ language: l.id, install: l.install })),
    auth: "Authorization: Bearer <api key> — a key scoped to the attached agent, minted when it is attached (POST /api/attached)",
    endpoints: {
      runs: {
        method: "POST",
        url: ENDPOINTS.ingest,
        accepts: "a run record: { agent, run: { id?, state, result, suspension?, journal: { entries: [...] } } } — the same shape the runtime writes. Report it as `suspended` with a suspension at a gate, and again when it finishes; the later report replaces the earlier under the same id.",
      },
      run: {
        method: "GET",
        url: `${ENDPOINTS.ingest}/<run id>`,
        returns: "{ state, answer, suspension } — what the agent polls while it waits at a gate; `answer` carries who approved or refused, when, and their note",
      },
      gates: {
        method: "POST",
        url: `${ENDPOINTS.origin}/api/approvals`,
        accepts: "{ run, approved, by, note } — how a gate is answered, from the control pane's dialog or by any caller with a key scoped to the agent",
      },
    },
    source: {
      python: "sdk/python — stdlib only; `pip install ./sdk/python`; example at sdk/python/examples/vendor_review.py",
      typescript: "sdk/typescript — no dependencies, Node 22+; example at sdk/typescript/examples/vendor-review.ts",
      go: "sdk/go — reference implementation of the same contract",
      java: "sdk/java — reference implementation, single file, Java 11+",
      csharp: "sdk/csharp — reference implementation, single file, .NET 8+",
    },
    contract: "a run is a journal the agent assembles in-process: run.start, tool.call/tool.result, model.call, taint, denied, gate.open/gate.answer, run.end — delivered to POST /api/sdk/runs as `suspended` at a gate and again when it finishes",
    records: RECORDED,
  });
}
