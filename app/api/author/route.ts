import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { readFile } from "node:fs/promises";

/**
 * The agent that builds agents — and the one agent that does not run in the
 * runtime, because it is part of the builder itself.
 *
 * A deployed agent is a document the runtime becomes. This one is a
 * conversation the UI holds: it reads the same capability reference the
 * runtime introspects from its own dataclasses, proposes documents through
 * the SAME parser that guards deployment, and a valid proposal lands as a
 * draft plus appears on the canvas for a person to review. Authoring and
 * authorising stay different powers — nothing here can reach the registry.
 *
 * The loop lives in this route (the control plane), not the Python runtime:
 * describing an agent is an interactive editing surface, not a workflow run,
 * so it has no journal, no policy engine, and no registry entry pretending
 * otherwise.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const exec = promisify(execFile);
const RUNTIME = path.resolve(process.cwd(), "..", "runtime");

/* ── credentials: the same vault the runtime reads, same overlay order ── */

async function foundryKey(): Promise<string> {
  try {
    const vault = JSON.parse(await readFile(path.join(path.resolve(process.cwd(), "..", "runtime"), "workspace", "vault.json"), "utf-8"));
    const v = vault?.keys?.foundry?.value;
    if (typeof v === "string" && v) return v;
  } catch {
    /* no vault yet */
  }
  return process.env.FOUNDRY_API_KEY ?? process.env.AZURE_AI_KEY ?? "";
}

/* ── the reference, introspected from the runtime so it cannot drift ── */

let refCache: { at: number; text: string } | null = null;

async function reference(): Promise<string> {
  if (refCache && Date.now() - refCache.at < 600_000) return refCache.text;
  const { stdout } = await exec(
    "python3",
    ["-c", "import json; from agentfactory.authoring import reference; print(json.dumps(reference(example=True)))"],
    { cwd: RUNTIME, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  );
  refCache = { at: Date.now(), text: stdout.trim() };
  return refCache.text;
}

/* ── proposal: the deployment parser answers, a valid one becomes a draft ── */

async function propose(document: unknown): Promise<Record<string, unknown>> {
  const script =
    "import json, sys, pathlib\n" +
    "from agentfactory.authoring import propose\n" +
    "doc = json.load(sys.stdin)\n" +
    "print(json.dumps(propose(pathlib.Path('workspace/drafts'), doc)))\n";
  return await new Promise((resolve) => {
    const child = execFile(
      "python3",
      ["-c", script],
      { cwd: RUNTIME, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) {
          resolve({ valid: false, error: `the validator could not run — ${err.message}`, path: "$" });
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim().split("\n").pop() ?? ""));
        } catch {
          resolve({ valid: false, error: "the validator returned something unreadable", path: "$" });
        }
      },
    );
    child.stdin?.write(JSON.stringify(document ?? {}));
    child.stdin?.end();
  });
}

/* ── the conversation loop ── */

const PROPOSE_TOOL = {
  type: "function",
  function: {
    name: "propose",
    description:
      "Submit a complete AgentSystem document for validation. The deployment parser answers " +
      "valid or not, with the exact field path of any refusal. A valid document is saved as a " +
      "draft and shown to the person on the canvas. Call this when the design is complete — " +
      "and after a refusal, fix precisely the named field and call it again.",
    parameters: {
      type: "object",
      properties: {
        document: {
          type: "object",
          description: "The complete AgentSystem JSON document (apiVersion, kind, metadata, spec).",
        },
      },
      required: ["document"],
    },
  },
};

function systemPrompt(ref: string): string {
  return systemPromptBody(ref, [
    "- Call the propose tool with the COMPLETE document. If it refuses, fix exactly the named",
    "  field and propose again — do not redesign what already passed.",
  ]);
}

function systemPromptBody(ref: string, proposeHow: string[]): string {
  return [
    "You are the Agent Factory builder — the conversational side of a visual canvas where cyber",
    "and GRC teams assemble agents (controls testing, DLP triage, third-party review, resilience",
    "audits, briefings). The person describes what they need; you design it from the parts that",
    "actually exist and propose it. You are part of the builder UI: be brief, concrete and",
    "collegial — a designer at the whiteboard, not a chatbot.",
    "",
    "How to work:",
    "- If the request is clear enough to design, design it now. Ask at most ONE round of",
    "  questions, and only when a wrong guess would change the shape of the workflow.",
    "- Choose the smallest harness that fits: sequence when the plan is fixed, delegate when the",
    "  model must decide what to look at next, await when a person or external system decides.",
    "- Use only the capabilities and connector kinds in the reference below. Never invent tools.",
    ...proposeHow,
    "- After a valid proposal, reply with two or three sentences: what the agent does, the one",
    "  or two judgment calls you made, and any open question worth a human decision. The person",
    "  sees the design on the canvas — do not paste JSON into the chat.",
    "- Credentials are always ${secret:name} references. Risky and destructive actions get",
    "  approval gates. Reading untrusted content and acting on the world never share a node.",
    "",
    "The reference — what exists, introspected from the runtime:",
    ref,
  ].join("\n");
}

interface Msg {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

export async function POST(req: Request) {
  const key = await foundryKey();

  let body: { messages?: { role: string; content: string }[]; model?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "send { messages: [...] }" }, { status: 400 });
  }
  const history = (body.messages ?? []).filter(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
  );
  if (!history.length || history[history.length - 1].role !== "user") {
    return Response.json({ error: "the last message must be from the user" }, { status: 400 });
  }

  let model = body.model;
  if (!model) {
    try {
      const cfg = JSON.parse(await readFile(path.join(RUNTIME, "workspace", "config.json"), "utf-8"));
      model = cfg.default_model;
    } catch {
      /* defaults below */
    }
  }
  if (!model) {
    return Response.json(
      { error: "No default model is configured. Choose one on the Configuration page or send { model }." },
      { status: 400 },
    );
  }

  let ref: string;
  try {
    ref = await reference();
  } catch (e) {
    return Response.json(
      { error: `could not read the capability reference — ${(e as Error).message}` },
      { status: 500 },
    );
  }

  if (!key) {
    return Response.json({ error: "No Foundry key — set FOUNDRY_API_KEY." }, { status: 503 });
  }

  const messages: Msg[] = [
    { role: "system", content: systemPrompt(ref) },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  /* Each proposal attempt is reported to the UI — the person watches the
     design converge the same way they watch a run's journal. */
  const events: { tool: string; ok: boolean; note: string }[] = [];
  let draft: { id: string; document: unknown; nodes: string[]; digest: string } | null = null;

  const endpoint = process.env.FOUNDRY_ENDPOINT ?? "";
  if (!endpoint) {
    return Response.json({ error: "No Foundry endpoint — set FOUNDRY_ENDPOINT." }, { status: 503 });
  }

  for (let round = 0; round < 6; round++) {
    let res: globalThis.Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "api-key": key,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          tools: [PROPOSE_TOOL],
          max_tokens: 8192,
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      return Response.json(
        { error: `Foundry unreachable — ${(e as Error).message}` },
        { status: 502 },
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return Response.json(
        { error: `Foundry returned ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ""}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    const choice = data.choices?.[0]?.message;
    if (!choice) return Response.json({ error: "the model returned nothing" }, { status: 502 });

    const calls: { id: string; function: { name: string; arguments: string } }[] =
      choice.tool_calls ?? [];

    if (!calls.length) {
      const text = String(choice.content ?? "").trim();
      if (!text) {
        // A reasoning-channel model can stop with its whole turn in
        // `reasoning` and nothing said. Nudge once per round: the thought is
        // not the answer.
        messages.push(
          { role: "assistant", content: String(choice.reasoning ?? "").slice(0, 4000) },
          {
            role: "user",
            content:
              "Your reasoning is not shown to the person. Reply with your actual answer now, " +
              "or call the propose tool with the complete document.",
          },
        );
        continue;
      }

      // A model that answers with a ```json block instead of calling the tool
      // still goes through the SAME validator as the tool path.
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) {
        let docObj: unknown = null;
        try {
          docObj = JSON.parse(fence[1]);
        } catch {
          /* not JSON — treated as prose below */
        }
        if (docObj && typeof docObj === "object" && "spec" in (docObj as object)) {
          const verdict = await propose(docObj);
          if (verdict.valid) {
            draft = {
              id: String(verdict.draft_id),
              document: docObj,
              nodes: (verdict.nodes as string[]) ?? [],
              digest: String(verdict.digest ?? ""),
            };
            events.push({ tool: "spec.propose", ok: true, note: `valid — draft "${draft.id}" saved` });
            const prose = text.replace(fence[0], "").trim();
            return Response.json({
              reply: prose || `The design passed the deployment parser — draft "${draft.id}" is ready to open on the canvas.`,
              events,
              draft,
              model,
            });
          }
          events.push({
            tool: "spec.propose",
            ok: false,
            note: `refused at ${verdict.path ?? "$"} — ${verdict.error}`,
          });
          messages.push(
            { role: "assistant", content: text },
            {
              role: "user",
              content:
                `The validator refused it at ${verdict.path}: ${verdict.error}. ` +
                "Fix precisely that field and output the corrected complete document in a single ```json block.",
            },
          );
          continue;
        }
      }

      return Response.json({ reply: text, events, draft, model });
    }

    messages.push({ role: "assistant", content: choice.content ?? "", tool_calls: choice.tool_calls });
    for (const call of calls) {
      let verdict: Record<string, unknown> | null = null;
      let args: { document?: unknown } = {};
      if (call.function.name !== "propose") {
        verdict = { valid: false, error: `no tool named ${call.function.name}`, path: "$" };
      } else {
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          verdict = { valid: false, error: "tool arguments were not valid JSON", path: "$" };
        }
        if (!verdict) verdict = await propose(args.document);
      }
      if (verdict.valid) {
        draft = {
          id: String(verdict.draft_id),
          document: args.document,
          nodes: (verdict.nodes as string[]) ?? [],
          digest: String(verdict.digest ?? ""),
        };
        events.push({ tool: "spec.propose", ok: true, note: `valid — draft "${draft.id}" saved` });
      } else {
        events.push({
          tool: "spec.propose",
          ok: false,
          note: `refused at ${verdict.path ?? "$"} — ${verdict.error}`,
        });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(verdict) });
    }
  }

  return Response.json({
    reply:
      "I ran out of design attempts before converging" +
      (events.length ? ` — the last refusal was: ${events[events.length - 1].note}` : "") +
      ". Tell me how to simplify, or adjust the shape and I will try again.",
    events,
    draft,
    model,
  });
}
