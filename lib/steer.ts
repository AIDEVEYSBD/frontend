/**
 * When a run can be steered.
 *
 * The steer address (`POST /api/runs/{id}/steer`, agentfactory/engine/steering.py)
 * takes a lever while the run is running or waiting at a gate for a person,
 * and refuses one for a run that has ended (409). The platform parks the
 * lever on the run; the worker carrying the run takes it at the run's next
 * step (its next model call, or its next tool call at or above write for a
 * hold), so a lever sent while the run waits at a gate is taken after the
 * gate is answered. A lever still pending when the run ends is never
 * applied. Pure, so tests/steer.test.ts holds the rule without a browser.
 */

export interface SteerOffer {
  /** Whether the steering panel is shown at all. */
  show: boolean;
  /** The run waits at a gate: every lever waits for its next step after the gate. */
  atGate: boolean;
}

/** The panel for a run as the page last saw it: `state` as the stream or the record said it, and whether a gate is on screen. */
export function steerOffer(run: { state: string; atGate: boolean }): SteerOffer {
  if (run.atGate || run.state === "suspended") return { show: true, atGate: true };
  if (run.state === "running") return { show: true, atGate: false };
  return { show: false, atGate: false };
}

/**
 * Whether a run's page follows it rather than replaying its record: it is
 * running, or it waits at a gate and has not finished. Either way it can
 * still be steered and killed from the page, and a gate is answered there.
 */
export function followsLive(record: { state: string; source?: string; finished_at?: string | null }): boolean {
  if (record.state === "running") return true;
  return record.state === "suspended" && !record.finished_at;
}
