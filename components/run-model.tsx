import { Mono, Tag } from "./ui";

/**
 * The model behind one model call, as the journal entry tells it.
 *
 * The runtime titles a `model.call` with the model it called; the model
 * gateway also records what the client asked for, how the factory chose
 * (`routed`: `auto`, `tier:small`), each model it tried on the way with the
 * upstream's status, and the name the upstream served under. The provider is
 * shown when the entry carries one. Nothing here is inferred: a field the
 * entry does not hold is not shown.
 */

type Rec = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface ModelCall {
  model: string;
  provider: string;
  /** The call went through the model gateway. */
  gateway: boolean;
  /** What the client named, when it differs from what was called. */
  requested: string;
  /** How the factory chose the model: `auto`, `tier:small`, `auto:tier:small`; "" when the client named it. */
  routed: string;
  /** Each model tried, in order, with the upstream's status (0: it did not answer). */
  tried: { model: string; status: number | null }[];
  /** The upstream's own name for what answered, when it differs. */
  served: string;
}

/** Whether a title reads as a model id rather than as words. */
const looksLikeModel = (s: string) => s !== "" && s.length <= 80 && !/\s/.test(s);

export function modelCallOf(e: { title?: string; data?: Rec | null }): ModelCall {
  const d = e.data ?? {};
  const model = str(d.model) || (looksLikeModel(e.title ?? "") ? String(e.title) : "");
  const requested = str(d.requested);
  const served = str(d.served_model);
  return {
    model,
    provider: str(d.provider),
    gateway: d.gateway === true,
    requested: requested && requested !== model ? requested : "",
    routed: str(d.routed),
    tried: (Array.isArray(d.tried) ? d.tried : [])
      .map((t) => {
        const o = (t && typeof t === "object" ? t : {}) as Rec;
        return { model: str(o.model), status: typeof o.status === "number" ? o.status : null };
      })
      .filter((t) => t.model),
    served: served && served !== model ? served : "",
  };
}

/** Whether the entry's title is its model (so it is not also the call's text). */
export function titleIsModel(e: { title?: string; data?: Rec | null }): boolean {
  const title = e.title ?? "";
  return title !== "" && (title === str(e.data?.model) || looksLikeModel(title));
}

const statusText = (s: number | null) => (s === null ? "status not recorded" : s === 0 ? "no answer" : String(s));

/** The fallback trail in words, or "" when the entry carries none. */
export function routeLine(m: ModelCall): string {
  const parts: string[] = [];
  if (m.requested) parts.push(`asked for ${m.requested}`);
  if (m.routed) parts.push(`routed ${m.routed}`);
  // One model tried and answered is not a trail; a failure, or more than one, is.
  if (m.tried.length > 1 || m.tried.some((t) => t.status !== null && (t.status === 0 || t.status >= 400))) {
    parts.push(`tried ${m.tried.map((t) => `${t.model} (${statusText(t.status)})`).join(", then ")}`);
  }
  if (m.served) parts.push(`served as ${m.served}`);
  return parts.join(" · ");
}

/** The model, its provider and the gateway mark, inline on a model call's row. */
export function ModelMark({ m }: { m: ModelCall }) {
  if (!m.model && !m.provider) return <span className="text-[10.5px] text-faint">model not recorded</span>;
  return (
    <>
      {m.model && <Mono className="text-[10.5px] text-fg">{m.model}</Mono>}
      {m.provider && <span className="text-[10.5px] text-faint">on {m.provider}</span>}
      {m.gateway && <Tag>through the gateway</Tag>}
    </>
  );
}
