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

/**
 * The answer's `not_built` list; empty when the answer has none (an older
 * platform, or a failed read). Some answers write it as a map of field to
 * reason (`GET /api/controls`); its keys are the list, and `notBuiltReason`
 * reads the reason.
 */
export function notBuiltOf(body: unknown): string[] {
  const list = body && typeof body === "object" ? (body as { not_built?: unknown }).not_built : undefined;
  if (Array.isArray(list)) return list.filter((x): x is string => typeof x === "string" && x !== "");
  if (list && typeof list === "object") return Object.keys(list).filter((k) => k !== "");
  return [];
}

/** The reason an answer gives for a field it names as not built, when it writes `not_built` as a map; "" otherwise. */
export function notBuiltReason(body: unknown, field: string): string {
  const map = body && typeof body === "object" ? (body as { not_built?: unknown }).not_built : undefined;
  if (!map || typeof map !== "object" || Array.isArray(map)) return "";
  const said = (map as Record<string, unknown>)[field];
  return typeof said === "string" ? said : "";
}

/** Whether `field` is named in the list, as written (`runs[].toolCalls`) or as its last part (`toolCalls`). */
export function notBuilt(list: readonly string[] | null | undefined, field: string): boolean {
  if (!list?.length) return false;
  return list.some((entry) => entry === field || entry.endsWith(`.${field}`));
}

/*
 * The run ledger's own list (`GET /api/runs` `not_built`, written as
 * `runs[].<field>`: `runs[].review`, `runs[].step_p95_ms` today), read once
 * per page load and shared, for a screen that shows one run and would
 * otherwise count a not-built field as zero. A failed read is `{ok: false}`
 * with its reason and is not kept: the next screen that asks reads again.
 */
export type RunRowsNotBuilt = { ok: true; list: string[] } | { ok: false; message: string };

let runRows: string[] | null = null;
let runRowsRead: Promise<RunRowsNotBuilt> | null = null;

export function readRunRowsNotBuilt(): Promise<RunRowsNotBuilt> {
  if (runRows) return Promise.resolve({ ok: true, list: runRows });
  runRowsRead ??= globalThis
    // Only the list of names is wanted: `scope=mine` keeps the rows that come with it few.
    .fetch("/api/runs?scope=mine", { cache: "no-store" })
    .then(async (r): Promise<RunRowsNotBuilt> => {
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) {
        runRowsRead = null;
        const said = d && typeof d.error === "string" ? d.error : "";
        return { ok: false, message: said ? `${said} (${r.status} from GET /api/runs)` : `the backend did not answer GET /api/runs (${r.status})` };
      }
      runRows = notBuiltOf(d);
      return { ok: true, list: runRows };
    })
    .catch((e: Error): RunRowsNotBuilt => {
      runRowsRead = null;
      return { ok: false, message: `the backend did not answer GET /api/runs (${e.message})` };
    });
  return runRowsRead;
}

/*
 * The deployment's configuration record (`GET /api/configuration`), read once
 * per page load and shared, for a screen that states what this deployment has
 * (its `not_built` list: `tools`, `egress`, ...; its egress allowlist) without
 * being the Configuration page. A failed read is `{ok: false}` and says
 * nothing either way: a screen then claims neither built nor not built.
 */
export type ConfigurationRead = { ok: true; notBuilt: string[]; body: Record<string, unknown> } | { ok: false; message: string };

let configurationRead: Promise<ConfigurationRead> | null = null;

export function readConfiguration(): Promise<ConfigurationRead> {
  configurationRead ??= globalThis
    .fetch("/api/configuration", { cache: "no-store" })
    .then(async (r): Promise<ConfigurationRead> => {
      const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      if (!r.ok || !body || typeof body !== "object") {
        const said = body && typeof body.error === "string" ? body.error : "";
        return { ok: false, message: said ? `${said} (${r.status} from GET /api/configuration)` : `the backend did not answer GET /api/configuration (${r.status})` };
      }
      return { ok: true, notBuilt: notBuiltOf(body), body };
    })
    .catch((e: Error) => ({ ok: false as const, message: `the backend did not answer GET /api/configuration (${e.message})` }))
    .then((got) => {
      // A failed read is asked again by the next screen that needs it.
      if (!got.ok) configurationRead = null;
      return got;
    });
  return configurationRead;
}

/**
 * Why a figure the answer gives as null is not known: the answer's own
 * reason beside it (`<field>_why` on the same object), else "not built" when
 * the answer's `not_built` list names the field, else a sentence saying the
 * answer gave none. Shown after "unknown", never instead of it.
 */
export function unknownWhy(row: unknown, field: string, list: readonly string[] = []): string {
  const o = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const said = o[`${field}_why`];
  if (typeof said === "string" && said.trim()) return said.trim();
  if (notBuilt(list, field)) return "not built";
  return "the answer gives no reason";
}
