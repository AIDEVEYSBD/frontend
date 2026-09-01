import type { ChildProcess } from "node:child_process";

/**
 * The live-run registry: every runtime process this control plane has in
 * flight, by run id. This is what the kill switch reaches for — a kill
 * switch that has to go looking for its target is not a switch.
 *
 * Stashed on globalThis so every route handler sees the same map regardless
 * of how the dev bundler splits module graphs.
 */

export interface ActiveRun {
  id: string;
  system: string;
  startedAt: string;
  child: ChildProcess;
}

const g = globalThis as typeof globalThis & { __afActiveRuns?: Map<string, ActiveRun> };
const REGISTRY: Map<string, ActiveRun> = (g.__afActiveRuns ??= new Map());

export function registerRun(run: ActiveRun): void {
  REGISTRY.set(run.id, run);
  run.child.once("close", () => REGISTRY.delete(run.id));
}

export function activeRuns(): Omit<ActiveRun, "child">[] {
  return [...REGISTRY.values()].map(({ id, system, startedAt }) => ({ id, system, startedAt }));
}

/** SIGTERM — the runtime traps it, journals the kill, and persists the run. */
export function killRun(id: string): boolean {
  const run = REGISTRY.get(id);
  if (!run) return false;
  return run.child.kill("SIGTERM");
}

export function killAll(): string[] {
  const killed: string[] = [];
  for (const run of REGISTRY.values()) {
    if (run.child.kill("SIGTERM")) killed.push(run.id);
  }
  return killed;
}
