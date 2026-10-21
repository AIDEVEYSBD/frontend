import { shortDigest, whenText } from "./lifecycle";
import type { DeliverableFile, DeliverableFilter, DeliverableSummary, GateDeliverable, HistoryStep, RegisterItem, RegisterSummary } from "./api/l8b";

/**
 * Deliverables and registers as the console says them (phase L8, second
 * round). A document a run writes is a deliverable: draft, reviewed (a
 * person approved it at the report gate, signed), published (the sink the
 * gate held fired), or withdrawn (the gate was refused, or the run aborted).
 * Only forward moves change its state; any other is kept on its history,
 * not applied. Rows a records backend writes are items of a register with
 * the same states. The file is served only from the outbox, only while it
 * carries the digest it was written with, never for a run an attached
 * agent reported. Pure: components/deliverables.tsx and components/approve.tsx
 * render these, tests/l8b-logic.test.ts and tests/l8b-contract.test.ts hold
 * them.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export type DeliverableTone = "neutral" | "warn" | "ok" | "err" | "queue";

export const DELIVERABLE_STATE_META: Record<string, { label: string; tone: DeliverableTone; means: string }> = {
  draft: { label: "draft", tone: "queue", means: "written by a run, not yet reviewed by a person" },
  reviewed: { label: "reviewed", tone: "warn", means: "a person approved it at the report gate, signed; the sink it held has not published it yet" },
  published: { label: "published", tone: "ok", means: "the sink the report gate held fired after the review" },
  withdrawn: { label: "withdrawn", tone: "neutral", means: "the report gate was refused, or the run aborted: it never left" },
};

export const deliverableStateMeta = (state: string) => DELIVERABLE_STATE_META[state] ?? { label: state.replace(/_/g, " "), tone: "neutral" as const, means: "" };

/** Where a deliverable came from, in a word. */
export const ORIGIN_LABEL: Record<string, string> = { engine: "a run here", worker: "a worker", sdk: "an attached agent (reported)" };

/** The browser's filters as the list door takes them: blanks left out. */
export function deliverableQuery(f: { state?: string; agent?: string; run?: string }): DeliverableFilter {
  const out: DeliverableFilter = {};
  if (f.state?.trim()) out.state = f.state.trim();
  if (f.agent?.trim()) out.agent = f.agent.trim();
  if (f.run?.trim()) out.run = f.run.trim();
  return out;
}

/** Counts by state in a line, in the states' own order: `1 draft · 1 published`; "none" for none. */
export function statesLine(states: Record<string, number>): string {
  const order = ["draft", "reviewed", "published", "withdrawn"];
  const keys = [...order.filter((k) => states[k]), ...Object.keys(states).filter((k) => !order.includes(k) && states[k]).sort()];
  return keys.length ? keys.map((k) => `${states[k]} ${deliverableStateMeta(k).label}`).join(" · ") : "none";
}

/** A file's name from its path, whichever separator wrote it. */
export const fileName = (path: string): string => path.split(/[\\/]/).pop() || path;

/** A size as read: `26 bytes`, `3.1 KB`. */
export function sizeText(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return plural(bytes, "byte");
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A deliverable in a line: kind, format, size, digest, where it came from. */
export function deliverableLine(d: Pick<DeliverableSummary, "kind" | "format" | "bytes" | "digest" | "origin" | "source">): string {
  return [d.kind, d.format, sizeText(d.bytes), d.digest ? shortDigest(d.digest) : "", d.source ? `by ${d.source}` : "", ORIGIN_LABEL[d.origin] ? `from ${ORIGIN_LABEL[d.origin]}` : d.origin].filter(Boolean).join(" · ");
}

/** One step of a deliverable's history, in a line. */
export function historyLine(h: HistoryStep): string {
  let line: string;
  switch (h.state) {
    case "draft":
      line = `Written${h.source ? ` by ${h.source}` : ""}${h.digest ? ` (${shortDigest(h.digest)})` : ""}`;
      break;
    case "reviewed":
      line = `Reviewed by ${h.by || "a person"}${h.tool ? ` at the gate holding ${h.tool}` : ""}${h.note ? `: ${h.note}` : ""}`;
      break;
    case "published":
      line = `Published${h.tool ? ` through ${h.tool}` : ""}${h.reviewed_by ? `, reviewed by ${h.reviewed_by}` : ""}`;
      break;
    case "withdrawn":
      line = `Withdrawn${h.by ? ` by ${h.by}` : ""}${h.aborted ? " (the run aborted)" : ""}${h.note ? `: ${h.note}` : ""}`;
      break;
    default:
      line = `${h.state.replace(/_/g, " ")}${h.by ? ` by ${h.by}` : ""}${h.note ? `: ${h.note}` : ""}`;
  }
  if (!h.applied) line += ". Not applied: only a forward move by the run that wrote it changes the state; this one is kept as the record of the attempt";
  return `${line}${h.at ? ` · ${whenText(h.at)}` : ""}`;
}

/** Why a file is not served, in a person's words. */
export const FILE_WHY: Record<string, string> = {
  missing: "the file is no longer on this deployment's disk",
  reported: "an attached agent reported this run: the file is on its own host, and nothing of it is read here",
  outside_outbox: "its path is outside the outbox, and only the outbox is served",
  digest: "the file on disk no longer has the digest it was written with, so it is not served as this deliverable",
};

/** Whether the file is served, in a line. */
export function fileLine(f: DeliverableFile): string {
  if (f.available) return "Served from the outbox, with the digest it was written with.";
  return `Not served: ${f.says || FILE_WHY[f.why] || f.why || "the backend did not say why"}.`;
}

/** A refused download in a person's words: why the door would not serve it. */
export function fileRefusalText(e: { status: number; message: string; body: Record<string, unknown> }): string {
  const why = typeof e.body.why === "string" ? e.body.why : "";
  if (why === "digest") {
    const found = typeof e.body.found === "string" ? e.body.found : "";
    return `The file changed since it was written: written ${shortDigest(String(e.body.digest ?? ""))}${found ? `, on disk now ${shortDigest(found)}` : ""}. It is not served as this deliverable.`;
  }
  if (why && FILE_WHY[why]) return `Not served: ${FILE_WHY[why]}.`;
  return e.message;
}

/* ═══════════════════ the report gate ═══════════════════ */

/** A deliverable the report gate names, in a line: kind, its state now, size and digest. */
export function gateDeliverableLine(d: GateDeliverable): string {
  const state = d.current_state && d.current_state !== d.state ? `${d.state}, ${deliverableStateMeta(d.current_state).label} now` : deliverableStateMeta(d.current_state || d.state).label;
  return [d.kind, state, d.format, sizeText(d.bytes), d.digest ? shortDigest(d.digest) : "", d.registered ? "" : "not registered"].filter(Boolean).join(" · ");
}

/** What answering the report gate does to what it names. */
export function reportGateNote(n: number, sink: string): string {
  const what = n === 1 ? "this deliverable" : `these ${n} deliverables`;
  return `The run wrote ${what} and wants to call ${sink || "a sink"}. Approving reviews ${n === 1 ? "it" : "them"}, signed with your name; the sink then fires and publishes ${n === 1 ? "it" : "them"}. Refusing withdraws ${n === 1 ? "it" : "them"}: nothing leaves.`;
}

/** The sink a report gate holds, from what it asks: "notify.send — notify.send is a sink…" names it first. */
export function sinkOfAsk(asks: string): string {
  return asks.split(/\s+[—-]\s+/)[0]?.trim() ?? "";
}

/* ═══════════════════ registers ═══════════════════ */

/** A register in a line: its items, their states, the backends and agents that wrote to it. */
export function registerLine(r: RegisterSummary): string {
  return `${plural(r.items, "item")} · ${statesLine(r.states)}${r.backends.length ? ` · backend ${r.backends.join(", ")}` : ""}${r.agents.length ? ` · written by ${r.agents.join(", ")}` : ""}`;
}

/** A register item in a line: its backend, its state, the run that last wrote it, how many times it was written. */
export function registerItemLine(i: RegisterItem): string {
  const writes = i.history.length;
  return `${i.backend} · ${deliverableStateMeta(i.state).label} · last written by ${i.run || "a run"}${writes > 1 ? ` (${plural(writes, "write")})` : ""}${i.digest ? ` · ${shortDigest(i.digest)}` : ""} · ${ORIGIN_LABEL[i.origin] ?? i.origin}`;
}
