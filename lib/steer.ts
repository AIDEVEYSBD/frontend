/**
 * When a run can be steered, and with which levers.
 *
 * The steer door (`POST /api/runs/{id}/steer`, backend/app/runs.py) takes a
 * steer for a run in flight: in-process, a worker's, or an SDK run. An SDK
 * run its agent holds open stays in flight at a gate (its control poll is
 * listening either way), so the backend takes a steer there too; any other
 * run at a gate is suspended and answers 409. Guidance and the next model
 * reach an SDK agent on its next control poll. The hold lever is not offered
 * while the run waits at a gate: it is already held for a person, and the
 * gate's answer decides what it does next. Pure, so tests/steer.test.ts
 * holds the rule without a browser.
 */

export interface SteerOffer {
  /** Whether the steering panel is shown at all. */
  show: boolean;
  hold: { allowed: boolean; reason: string };
}

export const HOLD_AT_GATE_REASON =
  "Not while the run waits at a gate: it is already held for a person, and the answer to this gate decides what it does next. Ask for a hold once the run is moving again.";

/** The levers a run offers in the theater: `state` as the stream last said it, whether it waits at a gate, and where it came from (`sdk`, `worker`, ""). */
export function steerOffer(run: { state: string; atGate: boolean; source: string }): SteerOffer {
  const sdk = run.source === "sdk";
  if (run.atGate || run.state === "suspended") {
    return sdk ? { show: true, hold: { allowed: false, reason: HOLD_AT_GATE_REASON } } : { show: false, hold: { allowed: false, reason: "" } };
  }
  if (run.state === "running") return { show: true, hold: { allowed: true, reason: "" } };
  return { show: false, hold: { allowed: false, reason: "" } };
}

/**
 * Whether a run's page follows it live rather than replaying its record:
 * it is running, or it is an SDK run its agent still holds open at a gate
 * (suspended, not finished), which can still be steered, killed and
 * answered from the page.
 */
export function followsLive(record: { state: string; source: string; finished_at?: string | null }): boolean {
  if (record.state === "running") return true;
  return record.source === "sdk" && record.state === "suspended" && !record.finished_at;
}
