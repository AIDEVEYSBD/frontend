import type { Tone } from "@/components/ui";
import type { ChainState, LedgerVerification, PackChainStatus, RunVerification } from "./api/l9";

/**
 * The hash chain, in words (phase L9). Each reading says what it means for
 * someone relying on the record: `valid` is true for ok, unanchored and
 * tombstoned, so "valid" alone would flatter a run still being written or one
 * retention deleted; this says which. Pure.
 */

export const CHAIN_META: Record<ChainState, { label: string; tone: Tone; means: string }> = {
  ok: { label: "Chain holds", tone: "ok", means: "every entry hashes to the next and the last is anchored in the ledger" },
  broken: { label: "Chain broken", tone: "err", means: "the record is not what was written" },
  unanchored: { label: "Not anchored yet", tone: "queue", means: "the chain holds so far; the ledger has no row for its last hash" },
  unchained: { label: "Before the chain", tone: "neutral", means: "recorded before the journal was chained: nothing here can be verified" },
  tombstoned: { label: "Tombstoned", tone: "neutral", means: "retention deleted it; the chain verifies across the tombstone and the ledger holds the deletion" },
};

export const PACK_CHAIN_META: Record<PackChainStatus, { label: string; tone: Tone; means: string }> = {
  unavailable: { label: "The run records could not be read", tone: "err", means: "nothing in this pack was checked, and an empty pack here is an outage, not a clean period" },
  no_runs: { label: "No run to verify", tone: "neutral", means: "this pack cites no run, so the chain says nothing about it" },
  ok: { label: "Every cited run holds", tone: "ok", means: "each run cited verifies against the ledger" },
  partial: { label: "Partly verifiable", tone: "warn", means: "a run cited is from before the chain, or has no anchor yet" },
  broken: { label: "A cited run is broken", tone: "err", means: "a run cited is not what was written" },
};

/** A run's reading, beside its status: where it breaks, what the door said, its place in the ledger. */
export function verifyLine(v: RunVerification): string {
  const at = v.broken_at === null ? "" : v.broken_at >= v.entries ? `Past entry ${v.entries - 1}: ` : `At entry ${v.broken_at}: `;
  const why = v.reason || CHAIN_META[v.chain].means;
  const said = at ? `${at}${why}` : `${why.charAt(0).toUpperCase()}${why.slice(1)}`;
  const pending = v.pending ? ` ${v.pending} note${v.pending === 1 ? "" : "s"} wait${v.pending === 1 ? "s" : ""} outside the chain until the run rests.` : "";
  const seq = v.recorded?.seq ? ` Anchor ${v.recorded.seq} in the ledger.` : "";
  return `${said}.${seq}${pending}`;
}

/** What a pack's chain says, from the door's own status. A pack that cites no run has its own: `no_runs`, never `ok`. */
export function packChainLine(c: { status: PackChainStatus; runs: number }): { title: string; tone: Tone; line: string } {
  const m = PACK_CHAIN_META[c.status];
  const means = `${m.means.charAt(0).toUpperCase()}${m.means.slice(1)}.`;
  return { title: m.label, tone: m.tone, line: c.status === "no_runs" || c.status === "unavailable" ? means : `${means} ${c.runs} run${c.runs === 1 ? "" : "s"} cited.` };
}

/** The walk as a headline. A break is a broken run, a gap, a genesis no row holds, or a row with no record. */
export function ledgerHeadline(l: LedgerVerification): { title: string; tone: Tone; line: string } {
  const scope = `${l.anchors} anchor${l.anchors === 1 ? "" : "s"} over ${l.runs} run${l.runs === 1 ? "" : "s"}`;
  if (!l.valid) return { title: "The ledger does not verify", tone: "err", line: `${l.breaks.length} break${l.breaks.length === 1 ? "" : "s"} in ${scope}; the first is below.` };
  if (!l.anchors) return { title: "Nothing anchored in this view", tone: "neutral", line: l.counts.unanchored + l.counts.unchained ? "Runs in flight, and runs from before the chain, have no row yet and do not fail the walk." : "No run has come to rest here yet." };
  return { title: "The ledger verifies", tone: "ok", line: `${scope}, in order, each genesis naming an anchor an earlier row holds.` };
}

/** What sits outside the walk and does not fail it. */
export function ledgerNotes(l: LedgerVerification): string[] {
  return [
    l.counts.unchained ? `${l.counts.unchained} run${l.counts.unchained === 1 ? " is" : "s are"} from before the chain: counted, never verified` : "",
    l.counts.unanchored ? `${l.counts.unanchored} run${l.counts.unanchored === 1 ? " has" : "s have"} no anchor yet` : "",
    l.truncated ? "The walk stopped at its limit; narrow the period to read the rest" : "",
  ].filter(Boolean);
}
