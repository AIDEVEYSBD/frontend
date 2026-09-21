import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { knowledgeReady, kq } from "@/lib/server/knowledge-db";
import { foundry } from "@/lib/server/foundry";
import { search, type Hit } from "@/app/api/knowledge/search/route";

/**
 * Agentic retrieval with a grounded answer.
 *
 * The search route finds passages; this route answers a question with them,
 * and refuses to answer past them. The loop:
 *
 *   1. Retrieve. The hybrid search with the cross-encoder rerank.
 *   2. Judge the evidence. When nothing relevant came back the query is
 *      rewritten outright. Otherwise a model reads the question beside what
 *      was found and says whether it can be answered completely from it;
 *      when it cannot, it names what is missing and the follow-up queries
 *      that would find it (a list only half covered, a term the passages
 *      use but the question did not, a sub-question not yet asked), and
 *      retrieval runs again on those. Up to three retrieval attempts in all.
 *   3. Add the outline. Passages are clauses; a question about a whole
 *      framework or list ("the top 10") needs the document's shape as well,
 *      so the section headings of the documents the evidence came from, each
 *      with the opening of its text, join the evidence as one more numbered
 *      passage per document.
 *   4. Answer from the passages only, citing each claim to the passage it
 *      came from by number.
 *   5. Check the grounding. A second model reads each cited sentence beside
 *      the passage it cites and says whether the passage supports it. A
 *      sentence that is not supported is reported as such; if attempts
 *      remain the answer is rewritten with those sentences called out.
 *
 * Every stage is streamed as it completes so a viewer sees the loop turn,
 * and the whole trace is returned at the end. The page shows what was done;
 * it makes no claim about what that guarantees.
 *
 * The loop is itself an agent, and it is journalled like one: every model
 * call it makes is written to a run record under the runtime's workspace,
 * attributed to the step that made it (rewrite, answer, judge), so the
 * Control and FinOps pages count its calls, tokens and cost beside every
 * other workflow's. The cross-encoder runs in-process at no metered cost
 * and is noted, not priced.
 */

const RUNS = path.resolve(process.cwd(), "..", "runtime", "workspace", "runs");
const SYSTEM = "knowledge-answer";

interface JournalEntry { t: number; kind: string; node: string; title: string; detail?: string; data: Record<string, unknown>; because: string[]; id: string; tainted: boolean }

/** A run record in the runtime's own shape, so every reader of the ledger sees this loop as a run. */
class Journal {
  readonly id = `ka-${randomUUID().slice(0, 10)}`;
  private readonly started = Date.now();
  readonly entries: JournalEntry[] = [];
  private node = "";
  constructor(question: string) {
    this.add("run.start", "", `Run ${this.id}`, { system: SYSTEM, question: question.slice(0, 400) });
  }
  private add(kind: string, node: string, title: string, data: Record<string, unknown>, detail = ""): JournalEntry {
    const e: JournalEntry = { t: Date.now() - this.started, kind, node, title, ...(detail ? { detail } : {}), data, because: [], id: randomUUID().replace(/-/g, "").slice(0, 12), tainted: false };
    this.entries.push(e);
    return e;
  }
  enter(node: string, title: string, data: Record<string, unknown> = {}) {
    if (this.node) this.exit();
    this.node = node;
    this.add("node.enter", node, title, data);
  }
  exit(data: Record<string, unknown> = {}) {
    if (!this.node) return;
    this.add("node.exit", this.node, this.node, data);
    this.node = "";
  }
  model(model: string, tokens: { in: number; out: number }, ms: number, detail: string) {
    this.add("model.call", this.node, model, { tokens, ms, intents: [] }, detail.slice(0, 2000));
  }
  note(title: string, data: Record<string, unknown>) {
    this.add("note", this.node, title, data);
  }
  async write(state: "done" | "failed", result: unknown, error = "") {
    this.exit();
    this.add("run.end", "", state, { state });
    const record = {
      id: this.id,
      system: SYSTEM,
      spec_digest: "",
      state,
      skipped: [],
      suspension: null,
      error,
      result,
      journal: { run_id: this.id, system: SYSTEM, spec_digest: "", duration_ms: Date.now() - this.started, entries: this.entries },
    };
    try {
      await mkdir(RUNS, { recursive: true });
      await writeFile(path.join(RUNS, `${this.id}.json`), JSON.stringify(record));
    } catch {
      /* the answer stands even if the record could not be written */
    }
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ATTEMPTS = 3;
/** Cross-encoder relevance below which the best passage is not evidence. */
const STRONG = 0.35;
const WEAK = 0.12;

interface Attempt {
  n: number;
  queries: string[];
  reason: string;
  hits: number;
  top: number | null;
  strong: number;
  verdict: "enough" | "retry" | "exhausted";
  /** What the assessor said was still missing, when it asked for another round. */
  missing?: string;
  ms: number;
}

interface Verdict {
  sentence: string;
  cites: number[];
  supported: boolean;
  note: string;
}

async function chat(system: string, user: string, opts: { json?: boolean; model?: string; maxTokens?: number; journal?: Journal } = {}): Promise<{ text: string; model: string; tokens: { in: number; out: number }; ms: number }> {
  const f = await foundry();
  if (!f) throw new Error("no model gateway configured (FOUNDRY_ENDPOINT / FOUNDRY_API_KEY)");
  // Fast and reliable in JSON mode matters more here than raw capability: the
  // loop makes up to six calls per question and a viewer is waiting on each.
  // RAG_MODEL overrides; the deployment default is the last resort.
  const model = opts.model || process.env.RAG_MODEL || "gpt-4o";
  const started = Date.now();
  const res = await fetch(`${f.base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", "api-key": f.key, authorization: `Bearer ${f.key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: opts.maxTokens ?? 2000,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(String(data?.error?.message ?? data?.error ?? `HTTP ${res.status}`).slice(0, 300));
  const msg = data.choices?.[0]?.message ?? {};
  const text = String(msg.content || msg.reasoning_content || msg.reasoning || "");
  if (!text.trim()) throw new Error(`the model returned nothing (finish_reason ${data.choices?.[0]?.finish_reason ?? "unknown"})`);
  const usage = data.usage ?? {};
  const out = { text, model, tokens: { in: Number(usage.prompt_tokens ?? 0), out: Number(usage.completion_tokens ?? 0) }, ms: Date.now() - started };
  opts.journal?.model(model, out.tokens, out.ms, text);
  return out;
}

function parseJson<T>(text: string): T {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  return JSON.parse(text.slice(a, b + 1)) as T;
}

/** Split prose into sentences, keeping the citation markers with the sentence they end. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?](?:\s*\[\d+\])*)\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const citesOf = (s: string) => [...s.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));

/** A document's shape: its item headings in order, each with the opening of its text. */
async function outlineOf(documentId: string): Promise<string> {
  const [doc] = await kq<{ title: string; pages: string[] | null; parts: number }>("SELECT title, pages, parts FROM documents WHERE id = $1", [documentId]);
  if (!doc) return "";
  const rows = await kq<{ heading: string; body: string; n: string }>(
    `SELECT s.heading, (SELECT c.body FROM chunks c WHERE c.section_id = s.id ORDER BY c.ordinal LIMIT 1) AS body,
            (SELECT count(*) FROM chunks c WHERE c.section_id = s.id) AS n
       FROM sections s WHERE s.document_id = $1 ORDER BY s.ordinal LIMIT 400`,
    [documentId],
  );
  if (!rows.length) return "";
  // The items of a list are the headings that carry an identifier (LLM01,
  // ASI03, A05, AC-2). With breadcrumb headings the item is the parent
  // segment, so its sub-sections collapse to one entry with the opening of
  // the first. A document without identifiers is outlined by its top-level
  // headings; failing that, its first headings.
  const IDENT = /\b(?:LLM|ASI|ML|API|A|T|K|M|C|V)\s?\d{1,2}\b|\b[A-Z]{2}-\d{1,2}\b/;
  const parent = (h: string) => h.split(" › ")[0].replace(/\s+/g, " ").trim();
  const collapse = (pick: (h: string) => boolean) => {
    const seen = new Map<string, { heading: string; body: string }>();
    for (const r of rows) {
      const p = parent(r.heading);
      if (!pick(p)) continue;
      if (!seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), { heading: p, body: r.body ?? "" });
      else if (!seen.get(p.toLowerCase())!.body && r.body) seen.get(p.toLowerCase())!.body = r.body;
    }
    return [...seen.values()];
  };
  let items = collapse((p) => IDENT.test(p));
  if (items.length < 3) items = collapse((p) => rows.some((r) => r.heading.includes(" › ") && parent(r.heading) === p));
  if (items.length < 3) items = rows.slice(0, 40).map((r) => ({ heading: r.heading, body: r.body ?? "" }));
  items = items.slice(0, 60);
  const lines = items.map((r, i) => `${i + 1}. ${r.heading.replace(/\s+/g, " ").trim()}${r.body ? `: ${r.body.replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
  return `Outline of "${doc.title}" (${doc.parts > 1 ? `${doc.parts} parts, ` : ""}${rows.length} sections). The items it contains, in order:\n${lines.join("\n")}`;
}

export async function POST(req: Request) {
  let body: { question?: string; limit?: number; sources?: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'expected {"question": "..."}' }, { status: 400 });
  }
  const question = String(body.question ?? "").trim();
  if (!question) return Response.json({ error: "send a question" }, { status: 400 });
  if (!(await knowledgeReady())) return Response.json({ error: "the knowledge index is unreachable" }, { status: 503 });
  const limit = Math.max(3, Math.min(16, Number(body.limit ?? 12)));
  const scoped = Array.isArray(body.sources) && body.sources.length ? body.sources.map(String) : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* viewer left */
        }
      };
      const beat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          /* closed */
        }
      }, 15_000);
      const started = Date.now();
      const journal = new Journal(question);
      const models = { rerank: null as string | null, answer: "", judge: "" };
      const tokens = { in: 0, out: 0 };
      const attempts: Attempt[] = [];
      try {
        /* ── retrieve, judge, rewrite ── */
        const pool = new Map<string, Hit>();
        let queries = [question];
        let reason = "the question as asked";
        let verdict: Attempt["verdict"] = "retry";
        for (let n = 1; n <= MAX_ATTEMPTS && verdict === "retry"; n++) {
          const t0 = Date.now();
          send({ type: "stage", stage: "retrieve", attempt: n, queries, reason });
          journal.enter("retrieve", `Retrieve · attempt ${n}`, { queries, reason });
          const poolBefore = pool.size;
          const results = await Promise.all(queries.map((q) => search({ query: q, limit, sources: scoped, adjacent: false })));
          for (const r of results) {
            models.rerank = r.rerankModel ?? models.rerank;
            for (const h of r.hits) {
              const have = pool.get(h.id);
              if (!have || (h.relevance ?? h.score) > (have.relevance ?? have.score)) pool.set(h.id, h);
            }
          }
          const ranked = [...pool.values()].sort((a, b) => (b.relevance ?? b.score) - (a.relevance ?? a.score));
          const top = ranked[0] ? (ranked[0].relevance ?? ranked[0].score) : null;
          const strong = ranked.filter((h) => (h.relevance ?? 0) >= STRONG).length;
          const hasCE = ranked.some((h) => h.relevance !== null);
          // A follow-up round that found almost nothing new is the corpus
          // saying it has no more; asking again would only spend the budget.
          const grew = ranked.length - poolBefore;
          const stalled = n > 1 && grew < 3;
          // Nothing relevant at all: rewrite outright, no need to ask.
          const nothing = hasCE ? strong === 0 : ranked.length === 0;
          let next: string[] = [];
          let why = "";
          let missing = "";
          let sufficient = false;

          if (!nothing && !stalled) {
            /* The assessor: can the question be answered completely from what
               has been found? If not, what is missing and what would find it. */
            send({ type: "stage", stage: "assess", attempt: n });
            journal.enter("assess", `Assess the evidence · attempt ${n}`, { hits: ranked.length, strong });
            let seen = ranked.slice(0, 16).map((h, i) => `[${i + 1}] (${h.source}${h.heading ? ` › ${h.heading}` : ""}) ${h.body.slice(0, 420).replace(/\s+/g, " ")}`).join("\n\n");
            // The outline of the document the best passage came from is part
            // of the evidence the answer will get, so the assessor sees it too;
            // otherwise a list question is judged incomplete on every round.
            try {
              for (const docId of [...new Set(ranked.slice(0, 8).map((h) => h.documentId))].slice(0, 2)) {
                const outline = await outlineOf(docId);
                if (outline) seen += `\n\n[outline] ${outline.slice(0, 3500)}`;
              }
            } catch {
              /* the outline is a help, not a requirement */
            }
            const tried = attempts.flatMap((a) => a.queries).concat(queries);
            const as = await chat(
              "You judge whether a set of retrieved passages is enough to write a complete, correct answer to a question, for a search over a curated corpus of security standards, frameworks, regulations, advisories and threat intelligence. " +
                "Sufficient means every part of the question has at least one passage that answers it, even if more detail could be found: for a list or 'top 10', every item appears in the passages or in an [outline] block (an outline lists a document's items in order, each with the opening of its text, and counts as evidence for each item it names); for a compound question, each part has a passage; for a definition, the thing is defined. " +
                "Insufficient means a specific, nameable part of the question has NO passage at all: an item absent from both passages and outline, a sub-question nothing addresses, a named document or section not retrieved. Richer detail is not a reason; when in doubt, it is sufficient. " +
                "If insufficient, name in one clause exactly what has no passage, and propose 1 to 3 follow-up queries that would find that and nothing else, in the vocabulary the documents use (item identifiers, section names, the passages' own terms). Never repeat a query already tried. " +
                'Reply with JSON only: {"sufficient": true|false, "missing": "...", "queries": ["..."]}.',
              `Question: ${question}\n\nQueries already tried:\n${tried.map((q) => `- ${q}`).join("\n")}\n\nPassages found so far (${ranked.length}):\n${seen}`,
              { json: true, maxTokens: 800, journal },
            );
            tokens.in += as.tokens.in;
            tokens.out += as.tokens.out;
            models.answer = as.model;
            try {
              const parsed = parseJson<{ sufficient?: boolean; missing?: string; queries?: string[] }>(as.text);
              sufficient = parsed.sufficient === true;
              missing = String(parsed.missing ?? "");
              next = (parsed.queries ?? []).map((q) => String(q).trim()).filter((q) => q && !tried.includes(q)).slice(0, 3);
            } catch {
              sufficient = true; // an unreadable judgement does not block the answer
            }
            why = missing ? `follow-up for what was missing: ${missing}` : "follow-up after an incomplete first pass";
          }

          if (stalled) {
            sufficient = true;
            missing = "";
          }
          verdict = sufficient ? "enough" : n === MAX_ATTEMPTS ? "exhausted" : "retry";
          const attempt: Attempt = { n, queries, reason, hits: ranked.length, top: top === null ? null : Number(top.toFixed(3)), strong, verdict, ...(missing ? { missing } : {}), ms: Date.now() - t0 };
          attempts.push(attempt);
          journal.note(`attempt ${n}: ${verdict}`, { hits: ranked.length, strong, top, missing, rerank: models.rerank ?? "none" });
          send({ type: "attempt", ...attempt });
          if (verdict !== "retry") break;

          if (nothing || !next.length) {
            /* rewrite: the model sees what came back and says what to ask instead */
            const seen = ranked.slice(0, 5).map((h, i) => `[${i + 1}] (${h.source}${h.heading ? ` › ${h.heading}` : ""}, relevance ${(h.relevance ?? 0).toFixed(2)}) ${h.body.slice(0, 240).replace(/\s+/g, " ")}`).join("\n");
            const tried = attempts.flatMap((a) => a.queries);
            send({ type: "stage", stage: "rewrite", attempt: n });
            journal.enter("rewrite", `Rewrite the query · attempt ${n}`);
            const rw = await chat(
              "You improve retrieval queries for a search over a curated corpus of security standards, frameworks, regulations, advisories and threat intelligence. " +
                "Given the question, the queries already tried and the weak passages they returned, propose 2 to 3 new queries that would find the answer: rephrase in the vocabulary the source documents use, " +
                "decompose a compound question into its parts, or widen an over-specific one. Also say in one short clause why. " +
                'Reply with JSON only: {"queries": ["..."], "why": "..."}.',
              `Question: ${question}\n\nAlready tried:\n${tried.map((q) => `- ${q}`).join("\n")}\n\nBest passages so far (${ranked.length} total, ${strong} above the bar):\n${seen || "(none)"}`,
              { json: true, maxTokens: 1500, journal },
            );
            tokens.in += rw.tokens.in;
            tokens.out += rw.tokens.out;
            models.answer = rw.model;
            try {
              const parsed = parseJson<{ queries?: string[]; why?: string }>(rw.text);
              next = (parsed.queries ?? []).map((q) => String(q).trim()).filter((q) => q && !tried.includes(q)).slice(0, 3);
              why = String(parsed.why ?? "") || why;
            } catch {
              /* fall through to a widened query */
            }
            if (!next.length) next = [question.replace(/[?.]+$/, "").split(/\s+/).slice(0, 6).join(" ")];
          }
          queries = next;
          reason = why || "rewritten after weak evidence";
        }

        const evidence = [...pool.values()]
          .sort((a, b) => (b.relevance ?? b.score) - (a.relevance ?? a.score))
          .filter((h) => h.relevance === null || h.relevance >= WEAK)
          .slice(0, Math.max(limit, 14));

        /* ── the outline of each document the evidence came from ── */
        if (evidence.length) {
          send({ type: "stage", stage: "outline" });
          const docIds = [...new Set(evidence.map((h) => h.documentId))].slice(0, 2);
          // A short document is read whole: when the best evidence comes from
          // a page of a few dozen chunks, the rest of that page costs little
          // and is what keeps a list from stopping halfway.
          const top = docIds[0];
          const have = new Set(evidence.map((h) => h.id));
          try {
            const rest = await kq<{ id: string; ordinal: number; heading: string; body: string }>(
              "SELECT id::text AS id, ordinal, heading, body FROM chunks WHERE document_id = $1 AND (SELECT count(*) FROM chunks WHERE document_id = $1) <= 30 ORDER BY ordinal",
              [top],
            );
            const like = evidence.find((h) => h.documentId === top)!;
            for (const r of rest) if (!have.has(r.id)) evidence.push({ ...like, id: r.id, ordinal: r.ordinal, heading: r.heading, body: r.body, similarity: null, lexicalRank: null, denseRank: null, score: 0, relevance: null, meta: {} });
          } catch {
            /* the whole-document read is a help, not a requirement */
          }
          for (const docId of docIds) {
            try {
              const outline = await outlineOf(docId);
              if (outline) evidence.push({ ...evidence.find((h) => h.documentId === docId)!, id: `outline:${docId}`, heading: "Outline", ordinal: 0, similarity: null, lexicalRank: null, denseRank: null, score: 0, relevance: null, meta: {}, body: outline });
            } catch {
              /* the outline is a help, not a requirement */
            }
          }
        }
        send({ type: "evidence", count: evidence.length, verdict });

        if (!evidence.length) {
          await journal.write("done", { answered: false, attempts: attempts.length });
          send({
            type: "done",
            question,
            answer: "",
            citations: [],
            grounding: null,
            attempts,
            verdict,
            models,
            tokens,
            ms: Date.now() - started,
            note: "Nothing in the admitted corpus is relevant enough to answer from. The question was retried with rewritten queries; no passage cleared the bar.",
          });
          return;
        }

        /* ── answer from the passages only ── */
        const numbered = evidence
          .map((h, i) => `[${i + 1}] Source: ${h.source}${h.heading ? ` › ${h.heading}` : ""} (${h.title})\n${h.body.replace(/\s+/g, " ").slice(0, 2200)}`)
          .join("\n\n");
        const ANSWER_SYSTEM =
          "You answer questions using only the numbered passages supplied, for a security practitioner who wants the substance, not a summary of it.\n" +
          "Citations: every factual sentence, bullet or table row carries its own citation written as [n] immediately after it, so a reader can check each claim against one passage; never collect citations at the end of a paragraph. " +
          "Example: 'Retrieval roles should be read-only [2]. Agents must not alter schemas [2][5].'\n" +
          "Grounding: never state anything the passages do not say. If the passages only partly answer, answer the part they cover and say plainly what they do not cover, with no citation on that sentence.\n" +
          "Depth: be as detailed as the passages allow and the question deserves. A question about a framework, standard, list or 'top 10' gets a short orientation paragraph and then every item the passages contain, each with a line or two of substance and its citation; a definitional question gets the definition, how it arises, and what mitigates it; a narrow factual question gets a direct answer. Do not truncate an enumeration the passages support.\n" +
          "Form: markdown. Use headings, bullet or numbered lists and tables where they make the answer easier to read; bold the name of each item in an enumeration and keep its identifier when the passages give one (LLM01, ASI03, AC-2). British spelling, no em dashes.\n" +
          "Charts: when the passages carry two or more comparable numbers (counts, scores, percentages, timelines), draw one chart after the sentence it supports as a fenced block with the language \"chart\" holding one JSON object, at most two per answer. Shapes: " +
          '{"type":"bar","title":"…","items":[{"label":"…","value":12,"meta":"…"}]} for a ranking or comparison; {"type":"donut","title":"…","items":[{"label":"…","value":9}]} for a split; ' +
          '{"type":"table","title":"…","columns":["…"],"rows":[["…","…"]]} for a structured comparison; {"type":"kpi","kpis":[{"label":"…","value":"…","sub":"…"}]} for headline figures. Never invent numbers for a chart.\n' +
          'Reply with JSON only: {"answer": "<markdown>", "covered": true|false, "gap": "what the passages do not cover, or empty"}.';
        const ask = async (feedback: string) => {
          send({ type: "stage", stage: feedback ? "rewrite-answer" : "answer" });
          journal.enter("answer", feedback ? "Rewrite unsupported sentences" : "Answer from the passages", { passages: evidence.length });
          const r = await chat(ANSWER_SYSTEM, `Question: ${question}\n\nPassages:\n${numbered}${feedback ? `\n\n${feedback}` : ""}`, { json: true, maxTokens: 8000, journal });
          tokens.in += r.tokens.in;
          tokens.out += r.tokens.out;
          models.answer = r.model;
          let answer = "";
          let covered = true;
          let gap = "";
          try {
            const parsed = parseJson<{ answer?: string; covered?: boolean; gap?: string }>(r.text);
            answer = String(parsed.answer ?? "").trim();
            covered = parsed.covered !== false;
            gap = String(parsed.gap ?? "");
          } catch {
            answer = r.text.trim();
          }
          return { answer, covered, gap, ms: r.ms };
        };

        /* ── grounding check ── */
        const judge = async (answer: string) => {
          send({ type: "stage", stage: "ground" });
          journal.enter("judge", "Check grounding");
          // Sentence by sentence, paragraph by paragraph. A sentence with no
          // citation of its own in a paragraph that ends with citations is
          // checked against those: the model was asked not to write that
          // way, but when it does the claim still gets checked, not skipped.
          const cited: { i: number; s: string; cites: number[] }[] = [];
          let i = 0;
          const prose = answer.replace(/```[\s\S]*?```/g, "");
          for (const block of prose.split(/\n{2,}/)) {
            // A list is one claim per line; a paragraph is one claim per sentence.
            const units = block.split("\n").filter((l) => l.trim() && !/^#{1,6}\s/.test(l.trim()) && !/^\|?\s*:?-{2,}/.test(l.trim()));
            const ss = units.length > 1 ? units.map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, "").replace(/^\|/, "").trim()) : sentences(block.replace(/^#{1,6}\s.*$/m, "").trim());
            const own = ss.map((s) => citesOf(s).filter((n) => n >= 1 && n <= evidence.length));
            const trailing = own.length ? own[own.length - 1] : [];
            ss.forEach((s, k) => {
              const cites = own[k].length ? own[k] : trailing;
              if (cites.length) cited.push({ i: i++, s, cites });
            });
          }
          if (!cited.length) return { verdicts: [] as Verdict[], model: "", ms: 0 };
          const items = cited
            .map((x) => `Sentence ${x.i}: ${x.s.replace(/\s*\[\d+\]/g, "").replace(/\*\*/g, "")}\nCited passages: ${x.cites.map((n) => `[${n}]`).join(" ")}`)
            .join("\n\n");
          const r = await chat(
            "You are a strict fact checker. For each sentence, decide whether the cited passage(s) support it: supported means the passage states it or it follows directly; " +
              "not supported means the passage does not say it, says something different, or the sentence adds a detail the passage lacks. Judge only against the cited passages. " +
              'Reply with JSON only: {"verdicts": [{"i": 0, "supported": true, "note": "one short clause"}]}.',
            `Passages:\n${numbered}\n\n${items}`,
            { json: true, maxTokens: 4000, model: process.env.RAG_JUDGE_MODEL || undefined, journal },
          );
          tokens.in += r.tokens.in;
          tokens.out += r.tokens.out;
          models.judge = r.model;
          const verdicts: Verdict[] = [];
          try {
            const parsed = parseJson<{ verdicts?: { i: number; supported: boolean; note?: string }[] }>(r.text);
            for (const v of parsed.verdicts ?? []) {
              const x = cited.find((c) => c.i === Number(v.i));
              if (x) verdicts.push({ sentence: x.s, cites: x.cites, supported: Boolean(v.supported), note: String(v.note ?? "") });
            }
          } catch {
            /* an unparseable judgement is reported as unchecked */
          }
          return { verdicts, model: r.model, ms: r.ms };
        };

        let draft = await ask("");
        let ground = await judge(draft.answer);
        let rounds = 1;
        let unsupported = ground.verdicts.filter((v) => !v.supported);
        if (unsupported.length && rounds < 2) {
          rounds += 1;
          send({ type: "grounding", round: 1, checked: ground.verdicts.length, unsupported: unsupported.length });
          const feedback =
            "A fact checker found these sentences NOT supported by the passages they cite. Rewrite the answer: remove each such claim or restate it to say only what its passage says, and cite correctly.\n" +
            unsupported.map((v) => `- "${v.sentence}" (${v.note || "not in the cited passage"})`).join("\n");
          draft = await ask(feedback);
          ground = await judge(draft.answer);
          unsupported = ground.verdicts.filter((v) => !v.supported);
        }

        const used = new Set(citesOf(draft.answer));
        await journal.write("done", { answered: true, cited: used.size, grounding: { checked: ground.verdicts.length, unsupported: unsupported.length } });
        send({
          type: "done",
          question,
          answer: draft.answer,
          covered: draft.covered,
          gap: draft.gap,
          citations: evidence.map((h, i) => ({
            n: i + 1,
            id: h.id,
            documentId: h.documentId,
            source: h.source,
            publisher: h.publisher,
            title: h.title,
            heading: h.heading,
            url: h.url,
            ordinal: h.ordinal,
            relevance: h.relevance,
            body: h.body,
            used: used.has(i + 1),
          })),
          grounding: {
            rounds,
            checked: ground.verdicts.length,
            supported: ground.verdicts.filter((v) => v.supported).length,
            unsupported: unsupported.length,
            verdicts: ground.verdicts,
          },
          attempts,
          verdict,
          models,
          tokens,
          ms: Date.now() - started,
        });
      } catch (e) {
        await journal.write("failed", null, (e as Error).message);
        send({ type: "error", error: (e as Error).message, attempts });
      } finally {
        clearInterval(beat);
        try {
          controller.close();
        } catch {
          /* closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
