import { redactText } from "./redact";

/**
 * The injection and exfiltration watch: every screened hit, every
 * taint-to-sink refusal and every egress refusal, read from the journals.
 *
 * A run record (the runtime's, the gateway's, an SDK agent's) is a list of
 * entries; this picks out the three kinds of event the watch lists and
 * says, for each, which control fired, on which application or agent, with
 * the excerpt the control saw. The excerpt is redacted here with the same
 * rule the runtime applies on the way in (lib/redact.ts), so a secret an
 * attacker tried to smuggle out is not shown to the person reviewing the
 * attempt. Pure over the record, so a recorded journal is a complete test.
 */

export type WatchKind = "screened" | "taint_sink" | "egress";

export interface WatchEvent {
  /** `${run}:${entry}` — stable across reads. */
  id: string;
  run: string;
  entry: string;
  kind: WatchKind;
  /** The control as the journal named it: the policy engine's key or the catalogue id. */
  control: string;
  /** What the control did: refused the call, or marked it and let it through. */
  action: "refused" | "flagged";
  subject: { kind: "application" | "agent"; id: string };
  principal: string;
  node: string;
  tool: string;
  title: string;
  detail: string;
  /** The text the control matched, redacted. */
  excerpt: string;
  /** Milliseconds into the run. */
  t: number;
  /** The record's clock: when the run file was last written. */
  at: string;
  /** Ids the entry was derived from, for the lineage drawer. */
  because: string[];
}

export interface WatchRecord {
  id: string;
  system?: string;
  application?: string;
  reported_by?: { mode?: string; door?: string; application?: string };
  journal?: { entries?: WatchEntry[] };
}

export interface WatchEntry {
  id?: string;
  t?: number;
  kind: string;
  node?: string;
  title?: string;
  detail?: string;
  because?: string[];
  tainted?: boolean;
  data?: Record<string, unknown>;
}

const SCREEN_RX = /^(injection|screen|screener|prompt|response|armor|model_armor|sensitive)/i;
const EGRESS_RX = /^(egress|network|host|exfil)/i;

function controlOf(e: WatchEntry): string {
  const named = e.data?.control;
  const first = Array.isArray(named) ? named[0] : named;
  return first ? String(first) : e.kind === "contract.breach" ? "contract.breach" : e.kind === "denied" ? "capability" : e.kind;
}

/** Which watch list an entry belongs on, or null when it is not a watched event. */
export function classify(e: WatchEntry): WatchKind | null {
  if (e.kind !== "denied" && e.kind !== "screened" && e.kind !== "contract.breach") return null;
  const control = controlOf(e);
  const d = e.data ?? {};
  if (e.kind === "screened" || SCREEN_RX.test(control) || d.screened === true || Array.isArray(d.reasons)) return "screened";
  if (EGRESS_RX.test(control)) return "egress";
  if (control === "taint" || control.startsWith("taint") || d.tainted === true || (Boolean(e.tainted) && Boolean(d.is_sink || d.sink))) return "taint_sink";
  return null;
}

/** The watch events one record holds, newest last (journal order). */
export function watchEventsOf(record: WatchRecord, at: string, live: readonly string[] = []): WatchEvent[] {
  const out: WatchEvent[] = [];
  const application = String(record.application ?? record.reported_by?.application ?? "");
  const subject: WatchEvent["subject"] = application ? { kind: "application", id: application } : { kind: "agent", id: String(record.system ?? "") };
  for (const e of record.journal?.entries ?? []) {
    const kind = classify(e);
    if (!kind) continue;
    const d = e.data ?? {};
    const action = d.action === "flag" || d.action === "flagged" || d.verdict === "flag" ? "flagged" : "refused";
    const rawExcerpt = typeof d.excerpt === "string" ? d.excerpt : typeof d.reason === "string" ? d.reason : Array.isArray(d.reasons) ? d.reasons.map(String).join("; ") : "";
    const perEntryApplication = typeof d.application === "string" && d.application ? { kind: "application" as const, id: d.application } : subject;
    out.push({
      id: `${record.id}:${e.id ?? ""}`,
      run: record.id,
      entry: String(e.id ?? ""),
      kind,
      control: controlOf(e),
      action,
      subject: perEntryApplication,
      principal: typeof d.principal === "string" ? d.principal : "",
      node: String(e.node ?? ""),
      tool: typeof d.tool === "string" ? d.tool : "",
      title: redactText(String(e.title ?? ""), live).slice(0, 200),
      detail: redactText(String(e.detail ?? ""), live).slice(0, 400),
      excerpt: redactText(rawExcerpt, live).slice(0, 600),
      t: Number(e.t ?? 0) || 0,
      at,
      because: Array.isArray(e.because) ? e.because.map(String) : [],
    });
  }
  return out;
}

export const WATCH_LABEL: Record<WatchKind, string> = {
  screened: "Screened hit",
  taint_sink: "Taint to sink",
  egress: "Egress refused",
};
