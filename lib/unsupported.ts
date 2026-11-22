/**
 * The parts of an agent's definition the platform does not carry out yet.
 *
 * `GET /api/agents` rows and `GET /api/agents/{agent}` carry
 * `unsupported: [{part, why}]`. Such an agent is saved, and deploying it or
 * starting a run of it is refused with 409 `{error, unsupported}`, so nothing
 * runs while appearing to obey a rule nobody enforces. The console shows the
 * list where the agent is shown and disables deploy and run with the reason.
 */

export interface UnsupportedPart {
  part: string;
  why: string;
}

/** The `unsupported` list of an agent row, an agent's detail or a 409 refusal; empty when it has none. */
export function unsupportedOf(x: unknown): UnsupportedPart[] {
  const list = x && typeof x === "object" ? (x as { unsupported?: unknown }).unsupported : undefined;
  if (!Array.isArray(list)) return [];
  return list
    .filter((p): p is { part: unknown; why?: unknown } => Boolean(p) && typeof p === "object" && "part" in p)
    .map((p) => ({ part: String(p.part), why: typeof p.why === "string" ? p.why : "" }));
}

/** Why deploy or run is off for an agent with unsupported parts, in one sentence. */
export function unsupportedReason(parts: UnsupportedPart[]): string {
  if (!parts.length) return "";
  const names = parts.map((p) => p.part).join(", ");
  return `Its definition uses ${parts.length === 1 ? "a part" : "parts"} the platform does not carry out yet (${names}), so it cannot be deployed or run.`;
}

/**
 * The parts that stop a run. `unsupported` describes the latest saved version,
 * and a run starts the deployed one: when the latest save is a draft newer
 * than what production runs, it stops a deploy and not a run (a run's own
 * refusal, 409 with `unsupported`, still says so if production is affected).
 * With nothing deployed the latest save would have to be deployed first, so
 * it stops both.
 */
export function runBlockers(parts: UnsupportedPart[], version: number | null | undefined, deployed: number | null | undefined): UnsupportedPart[] {
  if (!parts.length) return [];
  return deployed === null || deployed === undefined || deployed === version ? parts : [];
}

/** The heading over the parts: what they stop, given which version they describe. */
export function unsupportedHeading(version: number | null | undefined, deployed: number | null | undefined): string {
  if (deployed !== null && deployed !== undefined && deployed !== version)
    return `The latest save${typeof version === "number" ? ` (version ${version})` : ""} uses parts the platform does not carry out yet, so it cannot be deployed. Production runs version ${deployed}.`;
  return "Not carried out by the platform yet: deploy and run are off";
}
