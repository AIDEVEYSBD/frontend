import path from "node:path";

/**
 * Reranking: score each candidate passage against the question directly.
 *
 * Two scorers. The cross-encoder is the real one: a MiniLM model trained on
 * MS MARCO that reads the question and the passage together and returns one
 * relevance logit. It runs in-process on the CPU, needs no key, costs nothing
 * per call and answers in tens of milliseconds per passage, so it is the
 * default. The model files are fetched once and cached under the runtime
 * workspace, which the container mounts, so a rebuild does not refetch them.
 *
 * The LLM scorer is the fallback for a box where the model cannot be loaded:
 * it asks a chat model to score the passages 0 to 1. Slower, priced, and
 * less consistent, but it keeps the stage running rather than silently
 * degrading to the fused order.
 */

const CROSS_ENCODER = process.env.RERANK_CROSS_ENCODER ?? "Xenova/ms-marco-MiniLM-L-6-v2";
const CACHE = path.resolve(process.cwd(), "..", "runtime", "workspace", "models");

export interface Rerank {
  model: string;
  kind: "cross-encoder" | "llm";
  /** One score per passage, higher is more relevant. Cross-encoder scores are sigmoid(logit) in [0, 1]. */
  scores: number[];
  ms: number;
}

type Scorer = (query: string, passages: string[]) => Promise<number[]>;
let loading: Promise<Scorer | null> | null = null;

async function crossEncoder(): Promise<Scorer | null> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const tf = await import("@huggingface/transformers");
      tf.env.cacheDir = CACHE;
      tf.env.allowLocalModels = true;
      const tokenizer = await tf.AutoTokenizer.from_pretrained(CROSS_ENCODER);
      const model = await tf.AutoModelForSequenceClassification.from_pretrained(CROSS_ENCODER, { dtype: "q8" });
      return async (query: string, passages: string[]) => {
        const out: number[] = [];
        // Small batches: the box this runs on has a few cores, and one huge
        // batch pins memory for no gain in throughput.
        for (let i = 0; i < passages.length; i += 8) {
          const slice = passages.slice(i, i + 8);
          const inputs = tokenizer(new Array(slice.length).fill(query), { text_pair: slice, padding: true, truncation: true, max_length: 512 });
          const { logits } = await model(inputs);
          const data = logits.data as Float32Array;
          for (let j = 0; j < slice.length; j++) out.push(1 / (1 + Math.exp(-Number(data[j]))));
        }
        return out;
      };
    } catch (e) {
      console.warn(`[rerank] cross-encoder unavailable: ${(e as Error).message}`);
      return null;
    }
  })();
  return loading;
}

/** Is the local cross-encoder loaded (or loadable)? Cheap to call; loads on first use. */
export async function crossEncoderReady(): Promise<boolean> {
  return (await crossEncoder()) !== null;
}

export async function rerank(query: string, passages: string[]): Promise<Rerank | null> {
  if (!passages.length) return null;
  const started = Date.now();
  const ce = await crossEncoder();
  if (ce) {
    const scores = await ce(query, passages);
    return { model: CROSS_ENCODER, kind: "cross-encoder", scores, ms: Date.now() - started };
  }
  const llm = await llmScores(query, passages);
  return llm ? { ...llm, kind: "llm", ms: Date.now() - started } : null;
}

async function llmScores(query: string, passages: string[]): Promise<{ model: string; scores: number[] } | null> {
  const endpoint = process.env.FOUNDRY_ENDPOINT ?? "";
  const key = process.env.FOUNDRY_API_KEY || process.env.AZURE_AI_KEY || "";
  const model = process.env.RERANK_MODEL ?? "gpt-4o";
  if (!endpoint || !key) return null;
  const numbered = passages.map((p, i) => `[${i}] ${p.slice(0, 700).replace(/\s+/g, " ")}`).join("\n\n");
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": key, authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Score how well each numbered passage answers the question, 0 to 1. Reply with a single JSON object: " +
              '{"scores": [{"i": 0, "score": 0.0}]}. One entry per passage, no prose.',
          },
          { role: "user", content: `Question: ${query}\n\nPassages:\n${numbered}` },
        ],
        max_tokens: 900,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "");
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const scores = new Array(passages.length).fill(0);
    for (const row of parsed.scores ?? []) {
      const i = Number(row.i);
      if (Number.isInteger(i) && i >= 0 && i < scores.length) scores[i] = Number(row.score) || 0;
    }
    return { model, scores };
  } catch {
    return null;
  }
}
