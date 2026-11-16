/**
 * Where "open this agent" leads, in one place. With no Builder, an agent's
 * own page is its lifecycle: versions, reviews, the deploy gate.
 */
export function agentHref(id: string): string {
  return `/lifecycle?agent=${encodeURIComponent(id)}`;
}
