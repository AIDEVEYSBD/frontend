import type { LineageEntry } from "./lineage";
import type { SignedDecision } from "./api/l9";

/**
 * The provenance chain of a decision: what it stands on from the run's input
 * and prompt, and what it led to, down to the result.
 *
 * The runtime records this: `because` names the entries each was derived from
 * and the model's entries carry the prompt they were sent, and on a run
 * recorded now that alone reaches end to end. A record from before it does
 * not: its `resume` cites nothing that answers the gate (so a gate's answer
 * stops at the resume instead of reaching the gate and what the gate rested
 * on), its `run.end` cites nothing, and its first `node.enter` cites nothing.
 * For those records alone the three joins are made here, by journal position,
 * and each is marked as such: `link: "joined"` is not a citation the runtime
 * wrote, and the page says so. A record that does cite gets no join at all.
 *
 * Pure, over a journal: the run page and a test see the same chain.
 */

/** What an entry contributes to the chain. */
export type Role = "input" | "prompt" | "tool" | "result" | "gate" | "decision" | "refusal" | "step" | "note" | "outcome";

export interface ProvenanceStep<E extends LineageEntry = LineageEntry> {
  entry: E;
  role: Role;
  /** The chain's root: the decision being explained. */
  root: boolean;
  /** How this entry reached the chain: the runtime's `because`, or joined here by journal position. */
  link: "because" | "joined" | "root";
  /** The text that matters for this entry: the prompt, the answer, the arguments. */
  said: string;
}

export interface Provenance<E extends LineageEntry = LineageEntry> {
  root: E | null;
  /** In journal order: from the input to the result. */
  steps: ProvenanceStep<E>[];
  /** Ids a `because` names that the record does not hold: a hole in the chain is a finding. */
  missing: string[];
  /** A tainted entry stands anywhere upstream of the root. */
  tainted: boolean;
  /** How many steps were joined by position, not by a citation of the runtime's. */
  joined: number;
}

const roleOf = (e: LineageEntry): Role => {
  switch (e.kind) {
    case "run.start":
      return "input";
    case "model.call":
      return "prompt";
    case "tool.call":
      return "tool";
    case "tool.result":
      return "result";
    case "suspend":
    case "gate.open":
      return "gate";
    case "resume":
    case "gate.answer":
      return "decision";
    case "denied":
    case "contract.breach":
    case "error":
      return "refusal";
    case "run.end":
      return "outcome";
    case "note":
      return "note";
    default:
      return "step";
  }
};

const text = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v));

/** What an entry says: the input it took, the prompt and the answer, the arguments, the emitted values, the result. */
export function saidOf(e: LineageEntry): string {
  const d = e.data ?? {};
  switch (e.kind) {
    case "run.start":
      return text(d.system);
    case "node.enter":
      return d.inputs ? text(d.inputs) : e.detail ?? "";
    case "node.exit":
      return d.emitted ? text(d.emitted) : e.detail ?? "";
    case "model.call":
      return [d.prompt ? `Prompt: ${text(d.prompt)}` : "", e.detail ? `Answer: ${e.detail}` : ""].filter(Boolean).join("\n");
    case "tool.call":
      return d.args ? text(d.args) : e.detail ?? "";
    case "tool.result":
      return d.value !== undefined ? text(d.value) : e.detail ?? "";
    case "suspend":
      return d.presented ? `Presented: ${text(d.presented)}` : e.detail ?? "";
    case "run.end":
      return d.result ? `Result: ${text(d.result)}` : e.detail ?? "";
    default:
      return e.detail ?? "";
  }
}

/** The entries `because` does not reach, joined by position: on an older record, which does not cite them. */
function joinOf<E extends LineageEntry>(entries: readonly E[], index: Map<string, number>, e: E): E | null {
  const at = index.get(e.id) ?? -1;
  const back = (match: (x: E) => boolean): E | null => {
    for (let i = at - 1; i >= 0; i--) if (match(entries[i])) return entries[i];
    return null;
  };
  const cited = (e.because ?? []).map((id) => entries[index.get(id) ?? -1]).filter(Boolean);
  // A resume answers the suspension on its node. It may cite what its edges brought it and still not the gate.
  if (e.kind === "resume" && !cited.some((x) => x.kind === "suspend" || x.kind === "gate.open")) return back((x) => x.kind === "suspend" && x.node === e.node);
  // The run's end is what its last step emitted.
  if (e.kind === "run.end" && !cited.length) return back((x) => x.kind === "node.exit");
  // The first step of a run took the run's input.
  if (e.kind === "node.enter" && !cited.length) return back((x) => x.kind === "run.start");
  return null;
}

/**
 * The chain through one entry. Walks back along `because` (and the joins
 * above) to the run's start, then forward along the entries that cite the
 * root, then to `run.end`: a decision's chain runs from the prompt to the
 * result. `limit` caps the walk, as lib/lineage.ts does.
 */
export function provenanceOf<E extends LineageEntry>(entries: readonly E[], id: string, limit = 400): Provenance<E> {
  const byId = new Map<string, E>();
  const index = new Map<string, number>();
  entries.forEach((e, i) => {
    if (!e.id) return;
    byId.set(e.id, e);
    index.set(e.id, i);
  });
  const root = byId.get(id) ?? null;
  if (!root) return { root: null, steps: [], missing: [], tainted: false, joined: 0 };

  const links = new Map<string, ProvenanceStep<E>["link"]>([[root.id, "root"]]);
  const missing = new Set<string>();

  // Backwards: what it stands on.
  const back: E[] = [root];
  while (back.length && links.size < limit) {
    const e = back.shift() as E;
    for (const pid of e.because ?? []) {
      const parent = byId.get(pid);
      if (!parent) {
        missing.add(pid);
        continue;
      }
      if (links.has(parent.id)) continue;
      links.set(parent.id, "because");
      back.push(parent);
    }
    const joined = joinOf(entries, index, e);
    if (joined && !links.has(joined.id)) {
      links.set(joined.id, "joined");
      back.push(joined);
    }
  }
  const tainted = [...links.keys()].some((k) => byId.get(k)?.tainted);

  // Forwards: what it led to, down to the result.
  const cited = new Map<string, E[]>();
  for (const e of entries) for (const p of e.because ?? []) cited.set(p, [...(cited.get(p) ?? []), e]);
  const forward: E[] = [root];
  // A decision's own resume is cited by what the node emitted next, not by the answer.
  if (root.kind === "gate.answer") for (const p of root.because ?? []) if (byId.get(p)?.kind === "resume") forward.push(byId.get(p) as E);
  while (forward.length && links.size < limit) {
    const e = forward.shift() as E;
    for (const child of cited.get(e.id) ?? []) {
      if (links.has(child.id)) continue;
      links.set(child.id, "because");
      forward.push(child);
    }
  }
  // An older record's end cites nothing, so it is joined. A newer one's cites what it rests on: reached or not, that stands.
  const end = [...entries].reverse().find((e) => e.kind === "run.end");
  if (end && !links.has(end.id) && !(end.because ?? []).length) links.set(end.id, "joined");

  const steps = [...links.entries()]
    .map(([k, link]) => ({ entry: byId.get(k) as E, link }))
    .sort((a, b) => (index.get(a.entry.id) ?? 0) - (index.get(b.entry.id) ?? 0))
    .map(({ entry, link }) => ({ entry, link, role: roleOf(entry), root: entry.id === root.id, said: saidOf(entry) }));
  return { root, steps, missing: [...missing], tainted, joined: steps.filter((s) => s.link === "joined").length };
}

/** The entry a signed decision's chain runs through: the gate's answer on the journal, else the gate it answers. */
export function decisionEntry<E extends LineageEntry>(entries: readonly E[], d: Pick<SignedDecision, "gate" | "node"> & { entry?: string }): E | null {
  const named = d.entry ? entries.find((e) => e.id === d.entry) : undefined;
  if (named) return named;
  const at = entries.findIndex((e) => e.id === d.gate);
  const answer = entries.slice(Math.max(at, 0)).find((e) => e.kind === "gate.answer" && (!d.node || e.node === d.node));
  return answer ?? entries[at] ?? null;
}

/** An entry a person may ask the chain of. */
export const hasProvenance = (e: Pick<LineageEntry, "kind">): boolean => ["gate.answer", "denied", "contract.breach", "run.end", "model.call", "tool.call"].includes(e.kind);

export const ROLE_LABEL: Record<Role, string> = {
  input: "input",
  prompt: "model",
  tool: "tool call",
  result: "tool result",
  gate: "gate",
  decision: "decision",
  refusal: "refused",
  step: "step",
  note: "note",
  outcome: "result",
};
