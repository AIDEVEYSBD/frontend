/**
 * The `not_built` list the platform puts on an answer: the fields whose
 * feature is not built. Their values keep their type (an empty list, a zero,
 * a null), so a screen that shows one must say "not built" for it instead of
 * reading the empty value as "none".
 *
 * Entries are written as the answer's own paths: `runs[].toolCalls`,
 * `pending[].job`, `spent.tool_calls`, `journal.entries[].tainted`, or a bare
 * name for the answer as a whole (`producer`, `used_by`, `enforcement`).
 * `notBuilt(list, "toolCalls")` matches `runs[].toolCalls` as well as
 * `toolCalls`: the last part of an entry is the field, and a screen names the
 * field it shows.
 */

/** The answer's `not_built` list; empty when the answer has none (an older platform, or a failed read). */
export function notBuiltOf(body: unknown): string[] {
  const list = body && typeof body === "object" ? (body as { not_built?: unknown }).not_built : undefined;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/** Whether `field` is named in the list, as written (`runs[].toolCalls`) or as its last part (`toolCalls`). */
export function notBuilt(list: readonly string[] | null | undefined, field: string): boolean {
  if (!list?.length) return false;
  return list.some((entry) => entry === field || entry.endsWith(`.${field}`));
}

/*
 * The run ledger's own list (`GET /api/runs` `not_built`: `runs[].artifacts`,
 * `runs[].toolCalls`, ...), read once per page load and shared, for a screen
 * that shows one run and would otherwise count a not-built field as zero.
 * Empty until read, and empty when the read fails: an unknown list says
 * nothing is not built, and the screen shows what it counted.
 */
let runRows: string[] | null = null;
let runRowsRead: Promise<string[]> | null = null;

export function readRunRowsNotBuilt(): Promise<string[]> {
  if (runRows) return Promise.resolve(runRows);
  runRowsRead ??= globalThis
    // Only the list of names is wanted: `scope=mine` keeps the rows that come with it few.
    .fetch("/api/runs?scope=mine", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (runRows = notBuiltOf(d)))
    .catch(() => {
      runRowsRead = null;
      return [];
    });
  return runRowsRead;
}
