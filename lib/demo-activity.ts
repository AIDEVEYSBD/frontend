/**
 * Estate activity for catalogue connectors.
 *
 * A connector that is offered but not wired into a workflow on this
 * deployment still belongs to a client estate that is syncing, so the
 * configuration page shows it as connected estate-wide, with the activity a
 * connector of its kind carries. The numbers are derived from the connector's
 * slug rather than measured, so they are stable across reloads and the same
 * on every environment; the timestamps hang off the clock so a sync that ran
 * "12 min ago" keeps reading that way on the day it is shown.
 *
 * Demonstration data. Workflow-wired rows carry real journal counts and are
 * never touched by this module.
 */

export type Health = "healthy" | "degraded" | "reauth";

export interface Activity {
  /** Which part of the organisation owns the connection. */
  owner: string;
  /** The instance the connector points at, as an operator would name it. */
  instance: string;
  /** ISO time of the most recent successful sync. */
  lastSync: string;
  /** Sync cadence in minutes. */
  cadence: number;
  /** Objects ingested in the last 24 hours. */
  records24h: number;
  /** Calls made through the connector in the last 30 days. */
  calls30d: number;
  /** Days since the connection was established. */
  ageDays: number;
  health: Health;
}

const OWNER_BY_GROUP: Record<string, string> = {
  "Detection & response": "Security Operations",
  "Data protection & network": "Data Protection Office",
  "GRC & audit": "Risk and Compliance",
  "Identity & secrets": "Identity and Access",
  "Vulnerability & code": "Vulnerability Management",
  "Third-party risk": "Third-Party Risk",
  "Business systems": "Enterprise Applications",
  "Documents & data": "Data Engineering",
  "Cloud & DevOps": "Cloud Platform",
  "Communication & ITSM": "Service Management",
};

const REGIONS = ["eu-west", "uk-south", "ap-south", "us-east", "eu-central"];

/** FNV-1a, so the same slug always lands on the same numbers. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A stream of stable fractions in [0, 1) from one seed. */
function rand(seed: number): () => number {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

export function activityFor(slug: string, group: string, now = Date.now()): Activity {
  const r = rand(hash(slug));
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];

  // Detection and cloud tooling syncs on minutes; GRC and document systems on hours.
  const fast = /Detection|Cloud|Identity|Vulnerability|network/.test(group);
  const cadence = fast ? pick([5, 10, 15, 30]) : pick([60, 120, 240, 720]);
  const ageDays = 40 + Math.floor(r() * 380);

  // One connector in roughly twenty-five is degraded; one in eighty needs a
  // credential renewed. A page with nothing wrong on it is the giveaway.
  const roll = r();
  const health: Health = roll < 0.0125 ? "reauth" : roll < 0.05 ? "degraded" : "healthy";

  // The last good sync sits within one cadence of now, unless the connector
  // is unhealthy, in which case it is stale by hours or days.
  const sinceMin =
    health === "reauth" ? 60 * (30 + Math.floor(r() * 90)) : health === "degraded" ? cadence * (3 + Math.floor(r() * 8)) : Math.floor(r() * cadence);

  const dailyBase = fast ? 800 + r() * 24000 : 20 + r() * 900;
  const records24h = health === "reauth" ? 0 : Math.round(dailyBase * (health === "degraded" ? 0.4 : 1));
  const calls30d = Math.round((fast ? 300 + r() * 4200 : 30 + r() * 600) * (health === "reauth" ? 0.6 : 1));

  return {
    owner: OWNER_BY_GROUP[group] ?? "Security Operations",
    instance: `${pick(REGIONS)}-${1 + Math.floor(r() * 3)}`,
    lastSync: new Date(now - sinceMin * 60_000).toISOString(),
    cadence,
    records24h,
    calls30d,
    ageDays,
    health,
  };
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/* ═══════════════════ Attached agents ═══════════════════ */

export interface AgentActivity {
  lastSeen: string;
  runs30d: number;
  cost30d: number;
  denials30d: number;
  gates30d: number;
  p50ms: number;
}

/**
 * Activity for a seeded third-party agent. Same rule as the connectors above:
 * derived from the id so it is stable, hung off the clock so it stays fresh,
 * and never applied to an agent whose runs are actually on record.
 */
export function agentActivityFor(id: string, mode: "sdk" | "a2a", now = Date.now()): AgentActivity {
  const r = rand(hash(`agent:${id}`));
  // SDK agents are usually interactive assistants: many short runs. A2A agents
  // are usually queue-driven: fewer, longer, more tool-heavy runs.
  const runs30d = mode === "sdk" ? 180 + Math.floor(r() * 1400) : 40 + Math.floor(r() * 420);
  const perRun = mode === "sdk" ? 0.004 + r() * 0.03 : 0.02 + r() * 0.11;
  const denials30d = Math.floor(runs30d * (0.002 + r() * 0.012));
  const gates30d = mode === "a2a" ? Math.floor(runs30d * (0.05 + r() * 0.2)) : Math.floor(runs30d * (0.005 + r() * 0.03));
  const sinceMin = Math.floor(r() * (mode === "sdk" ? 45 : 240));
  return {
    lastSeen: new Date(now - sinceMin * 60_000).toISOString(),
    runs30d,
    cost30d: Math.round(runs30d * perRun * 100) / 100,
    denials30d,
    gates30d,
    p50ms: mode === "sdk" ? 900 + Math.floor(r() * 2600) : 4000 + Math.floor(r() * 21000),
  };
}
