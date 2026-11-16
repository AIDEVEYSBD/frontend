/**
 * Where "open this agent" leads, in one place: the agent's configuration
 * page (limits, bounds, gates, tools), which links on to its runs, its
 * lifecycle and its evals.
 */
export function agentHref(id: string): string {
  return `/agent?id=${encodeURIComponent(id)}`;
}
