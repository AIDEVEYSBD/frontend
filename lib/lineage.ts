/**
 * Taint lineage: where an entry came from, and where it went.
 *
 * Every journal entry carries `because`: the ids of the entries it was
 * derived from (a tool result from its call, a model call from the inputs
 * it read, a taint mark from the untrusted content it marked). Walking
 * `because` backwards answers "what did this come from"; walking it
 * forwards, through every entry that names this one, answers "what did it
 * feed". The walk is a pure function over the entries so the Runs page, the
 * Controls watch and a test all see the same chain.
 *
 * Both directions are breadth-first, nearest first, and cycle-safe: a
 * journal is append-only, so a real cycle cannot occur, but a malformed one
 * must not hang the page. An id named in `because` that the record does not
 * hold is reported as missing rather than silently dropped, because a hole
 * in the chain is itself a finding.
 */

export interface LineageEntry {
  id: string;
  t: number;
  kind: string;
  node?: string;
  title?: string;
  detail?: string;
  because?: string[];
  tainted?: boolean;
  data?: Record<string, unknown>;
}

export interface Hop<E extends LineageEntry = LineageEntry> {
  entry: E;
  /** 1 for a direct parent or child, 2 for their parent or child, and so on. */
  depth: number;
  /** The id of the entry this hop was reached through (the root at depth 1). */
  via: string;
}

export interface Lineage<E extends LineageEntry = LineageEntry> {
  root: E | null;
  /** Backwards along `because`: what the root was derived from, nearest first. */
  upstream: Hop<E>[];
  /** Forwards: the later entries that cite the root, directly or through others, nearest first. */
  downstream: Hop<E>[];
  /** Ids named in a `because` on the chain that the record does not hold. */
  missing: string[];
  /** Whether a tainted entry sits anywhere upstream of the root (the root included). */
  taintedUpstream: boolean;
  /** Downstream entries that are a sink or a refusal: where the taint went, or where it was stopped. */
  sinks: E[];
}

const SINK_KINDS = new Set(["denied", "contract.breach"]);

function isSink(e: LineageEntry): boolean {
  if (SINK_KINDS.has(e.kind)) return true;
  if (e.kind !== "tool.call") return false;
  const d = e.data ?? {};
  return Boolean(d.is_sink || d.sink || d.egress || (typeof d.risk === "string" && (d.risk === "destructive" || d.risk === "risky")));
}

/**
 * The lineage of one entry in a journal.
 *
 * `limit` caps each direction so a journal with thousands of entries still
 * answers in a page's time; the cap is reported through the hops that are
 * present, never by throwing.
 */
export function lineageOf<E extends LineageEntry>(entries: readonly E[], id: string, limit = 400): Lineage<E> {
  const byId = new Map<string, E>();
  for (const e of entries) if (e.id) byId.set(e.id, e);
  const root = byId.get(id) ?? null;
  const missing = new Set<string>();

  // Forward index: parent id → the entries whose `because` names it.
  const children = new Map<string, E[]>();
  for (const e of entries) {
    for (const p of e.because ?? []) {
      const list = children.get(p) ?? [];
      list.push(e);
      children.set(p, list);
    }
  }

  const upstream: Hop<E>[] = [];
  const downstream: Hop<E>[] = [];
  if (!root) return { root, upstream, downstream, missing: [], taintedUpstream: false, sinks: [] };

  // Backwards.
  {
    const seen = new Set<string>([root.id]);
    let frontier: { entry: E; depth: number }[] = [{ entry: root, depth: 0 }];
    while (frontier.length && upstream.length < limit) {
      const next: { entry: E; depth: number }[] = [];
      for (const { entry, depth } of frontier) {
        for (const pid of entry.because ?? []) {
          if (seen.has(pid)) continue;
          seen.add(pid);
          const parent = byId.get(pid);
          if (!parent) {
            missing.add(pid);
            continue;
          }
          upstream.push({ entry: parent, depth: depth + 1, via: entry.id });
          next.push({ entry: parent, depth: depth + 1 });
          if (upstream.length >= limit) break;
        }
        if (upstream.length >= limit) break;
      }
      frontier = next;
    }
  }

  // Forwards.
  {
    const seen = new Set<string>([root.id]);
    let frontier: { entry: E; depth: number }[] = [{ entry: root, depth: 0 }];
    while (frontier.length && downstream.length < limit) {
      const next: { entry: E; depth: number }[] = [];
      for (const { entry, depth } of frontier) {
        const kids = (children.get(entry.id) ?? []).slice().sort((a, b) => a.t - b.t);
        for (const child of kids) {
          if (!child.id || seen.has(child.id)) continue;
          seen.add(child.id);
          downstream.push({ entry: child, depth: depth + 1, via: entry.id });
          next.push({ entry: child, depth: depth + 1 });
          if (downstream.length >= limit) break;
        }
        if (downstream.length >= limit) break;
      }
      frontier = next;
    }
  }

  // Nearest first, then in journal order within a depth.
  const order = (a: Hop<E>, b: Hop<E>) => a.depth - b.depth || a.entry.t - b.entry.t;
  upstream.sort(order);
  downstream.sort(order);

  return {
    root,
    upstream,
    downstream,
    missing: [...missing],
    taintedUpstream: Boolean(root.tainted) || upstream.some((h) => h.entry.tainted || h.entry.kind === "taint"),
    sinks: downstream.map((h) => h.entry).filter(isSink),
  };
}

/** The entries a journal holds that are a taint mark, or carry taint: what the Runs transcript's "Taints" filter lists. */
export function taintedEntries<E extends LineageEntry>(entries: readonly E[]): E[] {
  return entries.filter((e) => e.kind === "taint" || e.tainted);
}
