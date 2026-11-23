import { Mono, Tag } from "./ui";

/**
 * The model behind one model call, as its journal entry tells it
 * (agentfactory/engine/harness/model_step.py `_call_data`).
 *
 * The entry names the model that answered, the endpoint it was called on,
 * and `routed`: the rule that chose the model ("route set for this step",
 * "default of the small tier", "deployment default"). When the call fell
 * back, the rule says from which model and why: "...; fell back from X: not
 * cleared for confidential" when the call's data class was not one X may be
 * sent, or "fell back from X, which did not answer" when X failed and the
 * call went to the next model in its chain (the journal also holds a note,
 * `data.control: "model.fallback"`, naming the model that failed and why).
 * Nothing here is inferred: a field the entry does not hold is not shown.
 */

type Rec = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface ModelCall {
  model: string;
  provider: string;
  /** What the step named, when it differs from what was called. */
  requested: string;
  /** The rule that chose the model; "" when the entry does not say. */
  rule: string;
  /** When the rule says the call fell back: the model passed over, and why. */
  fellBack: { from: string; why: string } | null;
  /** The endpoint's own name for what answered, when it differs. */
  served: string;
  /** How many times the call was sent to its endpoint, when more than once. */
  attempts: number | null;
}

/** Whether a title reads as a model id rather than as words. */
const looksLikeModel = (s: string) => s !== "" && s.length <= 80 && !/\s/.test(s);

/** The model a rule says the call fell back from, and why: "not cleared for <class>" or "did not answer". */
function fellBackOf(rule: string): ModelCall["fellBack"] {
  const m = rule.match(/fell back from ([^\s:,]+)(?:: |, )(.+)$/);
  if (!m) return null;
  return { from: m[1], why: m[2].replace(/^which /, "") };
}

export function modelCallOf(e: { title?: string; data?: Rec | null }): ModelCall {
  const d = e.data ?? {};
  const model = str(d.model) || (looksLikeModel(e.title ?? "") ? String(e.title) : "");
  const requested = str(d.requested);
  const served = str(d.served_model);
  const rule = str(d.routed);
  const attempts = typeof d.attempts === "number" && d.attempts > 1 ? d.attempts : null;
  return {
    model,
    provider: str(d.provider),
    requested: requested && requested !== model ? requested : "",
    rule,
    fellBack: fellBackOf(rule),
    served: served && served !== model ? served : "",
    attempts,
  };
}

/** Whether the entry's title is its model (so it is not also the call's text). */
export function titleIsModel(e: { title?: string; data?: Rec | null }): boolean {
  const title = e.title ?? "";
  return title !== "" && (title === str(e.data?.model) || looksLikeModel(title));
}

/** How the model was chosen, in words, or "" when the entry carries nothing to say. */
export function routeLine(m: ModelCall): string {
  const parts: string[] = [];
  if (m.requested) parts.push(`the step named ${m.requested}`);
  if (m.rule) parts.push(`chosen by: ${m.rule}`);
  if (m.served) parts.push(`served as ${m.served}`);
  if (m.attempts) parts.push(`sent ${m.attempts} times`);
  return parts.join(" · ");
}

/** The model, its endpoint, and a mark when the call fell back, inline on a model call's row. */
export function ModelMark({ m }: { m: ModelCall }) {
  if (!m.model && !m.provider) return <span className="text-[10.5px] text-faint">model not recorded</span>;
  return (
    <>
      {m.model && <Mono className="text-[10.5px] text-fg">{m.model}</Mono>}
      {m.provider && <span className="text-[10.5px] text-faint">on {m.provider}</span>}
      {m.fellBack && (
        <span className="inline-flex" title={m.rule}>
          <Tag tone="warn">
            fell back from {m.fellBack.from}: {m.fellBack.why}
          </Tag>
        </span>
      )}
    </>
  );
}
