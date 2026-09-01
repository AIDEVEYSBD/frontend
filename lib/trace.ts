/**
 * A single run, recorded as a timeline.
 *
 * Everything the theater shows is derived from this by time: the graph
 * state, the transcript, the artifact, the citations. That is what makes
 * the run scrubbable — there is no separate "current state" to keep in
 * sync, only `at(t)`.
 */

export type EventKind =
  | "start"
  | "tool"
  | "reason"
  | "evidence"
  | "write"
  | "decision"
  | "escalate"
  | "done";

export interface TraceEvent {
  t: number;
  node: string;
  kind: EventKind;
  title: string;
  detail?: string;
  meta?: string;
}

export interface Citation {
  id: string;
  doc: string;
  locator: string;
  quote: string;
}

export interface Segment {
  t: number;
  text: string;
  cite?: string;
}

export interface Node {
  id: string;
  label: string;
  kind: string;
  /** Seconds this node holds the run. */
  from: number;
  to: number;
}

export const NODES: Node[] = [
  { id: "intake", label: "Intake", kind: "extraction", from: 0, to: 14 },
  { id: "extract", label: "Extract", kind: "extraction", from: 14, to: 78 },
  { id: "prior", label: "Prior claims", kind: "research", from: 78, to: 126 },
  { id: "coverage", label: "Validate coverage", kind: "decision", from: 126, to: 232 },
  { id: "draft", label: "Draft response", kind: "drafting", from: 232, to: 318 },
  { id: "review", label: "Compliance review", kind: "review", from: 318, to: 372 },
  { id: "gate", label: "Human approval", kind: "gate", from: 372, to: 400 },
];

export const DOCUMENTS = [
  {
    id: "policy",
    name: "Policy 88-4417.pdf",
    meta: "Aviva · 14 pages",
    lines: [
      "Clause 4.1 — this policy covers sudden and accidental discharge of water from",
      "a plumbing system, heating system, or household appliance.",
      "Clause 4.2 — water damage arising from escape of water is covered where the",
      "escape is sudden and not the result of gradual deterioration.",
      "Clause 7.1 — no cover applies where the policy has lapsed at the date of loss.",
    ],
    highlight: 3,
  },
  {
    id: "rider",
    name: "Grace-period rider.pdf",
    meta: "Endorsement · 2 pages",
    lines: [
      "R-2 Where a renewal premium is unpaid at the renewal date, cover",
      "continues for a grace period of thirty (30) calendar days from that",
      "date, provided no prior lapse has occurred in the preceding 24 months.",
      "R-3 Claims arising within the grace period are settled in full.",
    ],
    highlight: 1,
  },
  {
    id: "fnol",
    name: "First notice of loss.docx",
    meta: "Claimant submission · 6 pages",
    lines: [
      "Date of loss: 12 August 2026, approximately 06:40.",
      "Description: Water discharge from upstairs bathroom, ceiling collapse",
      "in the kitchen below. Plumber attended same morning.",
      "Estimated damage: £14,200.",
    ],
    highlight: 1,
  },
];

export const CITATIONS: Citation[] = [
  {
    id: "c1",
    doc: "policy",
    locator: "Policy 88-4417 · clause 4.2",
    quote:
      "Water damage arising from escape of water is covered where the escape is sudden and not the result of gradual deterioration.",
  },
  {
    id: "c2",
    doc: "fnol",
    locator: "First notice of loss · p.1",
    quote: "Date of loss: 12 August 2026, approximately 06:40.",
  },
  {
    id: "c3",
    doc: "rider",
    locator: "Grace-period rider · R-2",
    quote:
      "Cover continues for a grace period of thirty (30) calendar days from that date, provided no prior lapse has occurred in the preceding 24 months.",
  },
  {
    id: "c4",
    doc: "rider",
    locator: "Grace-period rider · R-3",
    quote: "Claims arising within the grace period are settled in full.",
  },
];

export const EVENTS: TraceEvent[] = [
  { t: 2, node: "intake", kind: "start", title: "Run started", detail: "CL-88213 · R. Alvarez", meta: "claims-intake v12" },
  { t: 6, node: "intake", kind: "tool", title: 'doc_store.fetch(claim="CL-88213")', detail: "3 documents · 22 pages", meta: "200 · 0.6s" },
  { t: 14, node: "intake", kind: "done", title: "Intake complete", meta: "0:14" },

  { t: 20, node: "extract", kind: "tool", title: "ocr.read(pages=22)", detail: "22 pages · 1 scan corrected", meta: "200 · 3.1s" },
  { t: 38, node: "extract", kind: "reason", title: "Three documents: the policy schedule, the grace-period endorsement, and the claimant's first notice of loss. Extracting the loss date, the peril, and the renewal position." },
  { t: 52, node: "extract", kind: "evidence", title: "Loss date extracted", detail: "12 August 2026, 06:40", meta: "fnol · p.1" },
  { t: 64, node: "extract", kind: "evidence", title: "Renewal date extracted", detail: "1 August 2026 · premium unpaid", meta: "policy · p.2" },
  { t: 78, node: "extract", kind: "done", title: "Extract complete", detail: "14 fields · every field cited", meta: "1:04" },

  { t: 86, node: "prior", kind: "tool", title: 'claims_db.search(insured="R. Alvarez", months=36)', meta: "200 · 0.9s" },
  { t: 98, node: "prior", kind: "reason", title: "No prior escape-of-water claims in 36 months, and no prior lapse — which matters, because the rider withdraws the grace period if one exists." },
  { t: 126, node: "prior", kind: "done", title: "No prior claims found", detail: "0 matches · 36 months", meta: "0:48" },

  { t: 134, node: "coverage", kind: "tool", title: 'policy_db.lookup(policy="88-4417")', detail: "renewed 2026-03-02 · rider: grace-period", meta: "200 · 0.4s" },
  { t: 148, node: "coverage", kind: "reason", title: "The peril is covered under clause 4.2 — the discharge was sudden, not gradual. But the loss date falls 11 days after an unpaid renewal, so clause 7.1 would exclude it unless the grace-period rider applies." },
  { t: 168, node: "coverage", kind: "evidence", title: "Peril matches clause 4.2", detail: "sudden discharge, not deterioration", meta: "policy · clause 4.2" },
  { t: 184, node: "coverage", kind: "tool", title: 'coverage_rules.evaluate(rider="grace-period", loss_date="2026-08-12")', detail: "within window: 11 of 30 days", meta: "200 · 1.2s" },
  { t: 206, node: "coverage", kind: "evidence", title: "Grace period applies", detail: "11 days elapsed of 30 · no prior lapse", meta: "rider · R-2" },
  { t: 232, node: "coverage", kind: "decision", title: "Covered in full", detail: "clause 4.2 peril · rider R-2 restores cover · R-3 settles in full", meta: "confidence 0.93" },

  { t: 240, node: "draft", kind: "tool", title: 'template.load("coverage-confirmation")', meta: "200 · 0.2s" },
  { t: 252, node: "draft", kind: "write", title: "Drafting coverage confirmation" },
  { t: 318, node: "draft", kind: "done", title: "Draft complete", detail: "4 citations · 0 unsupported claims", meta: "1:26" },

  { t: 326, node: "review", kind: "tool", title: "controls.load(set=\"uk-claims-2026\")", detail: "12 controls", meta: "200 · 0.3s" },
  { t: 344, node: "review", kind: "reason", title: "Every assertion in the draft resolves to a cited clause. Tone check passes. One control requires the grace-period calculation to be shown to the claimant rather than merely asserted." },
  { t: 358, node: "review", kind: "evidence", title: "12 of 12 controls passed", detail: "1 advisory: show the day count", meta: "uk-claims-2026" },
  { t: 372, node: "review", kind: "done", title: "Compliance review complete", meta: "0:54" },

  { t: 380, node: "gate", kind: "escalate", title: "Awaiting partner approval", detail: "Settlement above £10,000 requires sign-off", meta: "S. Rahman" },
];

/** The artifact, written in over time. Segments carry their citation. */
export const SEGMENTS: Segment[] = [
  { t: 256, text: "Dear Mr Alvarez," },
  { t: 262, text: "We have completed our assessment of claim CL-88213 and can confirm that the damage reported at your property is covered in full under your policy." },
  { t: 274, text: "The escape of water you reported on 12 August 2026 falls within the cover provided by clause 4.2 of policy 88-4417, which covers sudden discharge of water that is not the result of gradual deterioration.", cite: "c1" },
  { t: 288, text: "We note that your renewal premium was outstanding at the date of loss.", cite: "c2" },
  { t: 298, text: "Your policy includes a grace-period endorsement, under which cover continues for thirty days from the renewal date where no prior lapse has occurred. Your loss occurred on day 11 of that period.", cite: "c3" },
  { t: 310, text: "Claims arising within the grace period are settled in full, and we are therefore settling your claim without deduction.", cite: "c4" },
  { t: 316, text: "A loss adjuster will contact you within two working days to agree the schedule of works." },
];

export const RUN_END = 400;

/** State of the run at a given second. */
export function at(t: number) {
  const events = EVENTS.filter((e) => e.t <= t);
  const segments = SEGMENTS.filter((s) => s.t <= t);
  const node = NODES.find((n) => t >= n.from && t < n.to) ?? NODES[NODES.length - 1];

  const nodeState = (n: Node) =>
    t >= n.to ? "done" : t >= n.from ? "active" : "pending";

  const cites = new Set(segments.map((s) => s.cite).filter(Boolean) as string[]);

  return {
    events,
    segments,
    node,
    nodeState,
    citations: CITATIONS.filter((c) => cites.has(c.id)),
    cost: Math.min(1.12, (t / RUN_END) * 1.12),
    confidence: t < 232 ? null : 0.93,
  };
}

export const clock = (t: number) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
