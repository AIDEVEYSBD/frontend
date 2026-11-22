/**
 * How each tool call in a run's journal ended, read the way the engine
 * writes it (phase2-contract.md §2; the engine's journal module, "Tool
 * calls"): a `tool.call` entry is closed by exactly one later entry, its
 * `tool.result`, or a `denied` or an `error` that cites it in `because`.
 * A call nothing closes is in flight, or its worker died and the run waits
 * for a person to say whether it happened: the engine then writes a `note`
 * "Step interrupted" (`control: worker.interrupted`, `request` = the call)
 * and a `gate.open` "Outcome unknown: <tool>" (`outcome: "unknown"`), each
 * citing the call.
 *
 * Pairing is through `because`, never by position. A journal written before
 * the engine cited its calls (no closing entry anywhere names a call) is read
 * the old way: the n-th result of a tool belongs to the n-th call of it.
 *
 * Pure: used by the run record's transcript, its linked-entry lookup and the
 * flow view (lib/run-fold.ts).
 */

export interface CallEntry {
  id: string;
  kind: string;
  t: number;
  node?: string;
  title?: string;
  detail?: string;
  because?: string[] | null;
  data?: Record<string, unknown> | null;
  tainted?: boolean;
}

export type CallState =
  /** A `tool.result` closed it. */
  | "returned"
  /** A `denied` closed it: the host, the result screener or the class check refused after the call was recorded. */
  | "refused"
  /** An `error` closed it: the call went wrong, or a person said it did not happen. */
  | "failed"
  /** A `gate.open` cites it and nothing has closed it: the run waits for a person (a sub-run held for review). */
  | "held"
  /** Its worker died before the answer was recorded and the tool may not be repeated: a person must say whether it happened. */
  | "unknown"
  /** Nothing closes it yet. */
  | "open";

export interface CallOutcome<E extends CallEntry = CallEntry> {
  state: CallState;
  /** The closing entry (`tool.result`, `denied`, `error`), when there is one. */
  closing?: E;
  /** A `gate.open` that cites the call. */
  gate?: E;
  /** The engine's note that the worker stopped while the call was being made. */
  interrupted?: E;
}

const CLOSING = new Set(["tool.result", "denied", "error"]);

const citesOf = (e: CallEntry): string[] => {
  const out = Array.isArray(e.because) ? e.because.filter((x): x is string => typeof x === "string" && x !== "") : [];
  // The interrupted note names the call in `request` as well as in `because`.
  const request = e.data?.request;
  if (typeof request === "string" && request && !out.includes(request)) out.push(request);
  return out;
};

const toolOf = (e: CallEntry): string => {
  const named = e.data?.tool;
  if (typeof named === "string" && named) return named;
  return e.kind === "tool.result" ? String(e.title ?? "").replace(/ returned$/, "") : String(e.title ?? "");
};

/** Every `tool.call` of the journal, by its id, with how it ended so far. */
export function callOutcomes<E extends CallEntry>(entries: readonly E[]): Map<string, CallOutcome<E>> {
  const calls = entries.filter((e) => e.kind === "tool.call" && e.id);
  const out = new Map<string, CallOutcome<E>>(calls.map((c) => [c.id, { state: "open" as CallState }]));
  if (calls.length === 0) return out;

  // Does any entry cite a call (a closing entry, a gate over it, the interrupted note)? If none does, the journal
  // predates citing and is paired by position; a gate or a note citing a call is read in either case.
  const cited = entries.some((e) => e.kind !== "tool.call" && citesOf(e).some((id) => out.has(id)));

  for (const e of entries) {
    if (e.kind === "tool.call") continue;
    for (const id of citesOf(e)) {
      const o = out.get(id);
      if (!o) continue;
      if (CLOSING.has(e.kind)) {
        // Exactly one entry closes a call; a second one citing it (a later note) does not reopen or replace it.
        if (!o.closing) o.closing = e;
      } else if (e.kind === "gate.open") {
        o.gate ??= e;
      } else if (e.kind === "note" && e.data?.control === "worker.interrupted") {
        o.interrupted ??= e;
      }
    }
  }
  if (!cited) {
    // The old pairing: per tool name, results in order to calls in order.
    const open = new Map<string, E[]>();
    for (const e of entries) {
      if (e.kind === "tool.call") {
        const k = toolOf(e);
        open.set(k, [...(open.get(k) ?? []), e]);
      } else if (e.kind === "tool.result") {
        const queue = open.get(toolOf(e));
        const call = queue?.shift();
        if (call && !out.get(call.id)!.closing) out.get(call.id)!.closing = e;
      }
    }
  }

  for (const o of out.values()) {
    if (o.closing) o.state = o.closing.kind === "tool.result" ? "returned" : o.closing.kind === "denied" ? "refused" : "failed";
    else if (o.gate) o.state = o.gate.data?.outcome === "unknown" || o.gate.data?.control === "worker.interrupted" ? "unknown" : "held";
    else if (o.interrupted && o.interrupted.data?.outcome !== "repeated") o.state = "unknown";
  }
  return out;
}

/** The call an entry closes or is cited by (a result, a refusal, a failure after the call, an outcome-unknown gate), or "" when it belongs to none. */
export function callOfEntry<E extends CallEntry>(outcomes: Map<string, CallOutcome<E>>, entryId: string): string {
  for (const [call, o] of outcomes) {
    if (o.closing?.id === entryId || o.gate?.id === entryId || o.interrupted?.id === entryId) return call;
  }
  return "";
}

/** The words a call's state is shown in, and its tone. `live`: the run is still going, so an open call is in flight rather than unanswered. */
export function callStateLabel(state: CallState, live: boolean): { text: string; tone: "ok" | "err" | "warn" | "faint" } {
  switch (state) {
    case "returned":
      return { text: "returned", tone: "ok" };
    case "refused":
      return { text: "refused after the call was recorded", tone: "err" };
    case "failed":
      return { text: "failed", tone: "err" };
    case "held":
      return { text: "waiting for a person", tone: "warn" };
    case "unknown":
      return { text: "outcome unknown", tone: "warn" };
    default:
      return live ? { text: "in flight", tone: "faint" } : { text: "no outcome on record", tone: "warn" };
  }
}
