/**
 * A hue for every card, chosen from what the card is about.
 *
 * Card headers carry a tint so a page reads as a set of distinct instruments
 * rather than a stack of grey bars. The hue follows the subject, not the
 * page: spend is green wherever it appears, approvals are amber, live
 * activity is blue, refusals and findings are red, knowledge is violet,
 * identity and credentials are teal, models and traces are indigo. The
 * colours themselves live in the accent block of globals.css, so removing
 * that block removes every tint at once and leaves these attributes inert.
 */
export type Hue = "green" | "amber" | "blue" | "red" | "violet" | "teal" | "indigo" | "slate";

const RULES: [RegExp, Hue][] = [
  [/guardrail|control|denial|kill|refus|finding|breach/i, "red"],
  [/spend|finops|budget|cost|billing|price|model/i, "green"],
  [/approv|gate|sign|person|people|human|queue/i, "amber"],
  [/risk|threat/i, "red"],
  [/knowledge|source|corpus|retriev|pipeline|document|admission|telemetry/i, "violet"],
  [/identit|credential|key|vault|ingress|mcp|attached|agent factory as|audit|privilege/i, "teal"],
  [/latency|observ|trace|routing|peer|roster|ledger|journal/i, "indigo"],
  [/artifact|output|report/i, "violet"],
  [/activity|health/i, "blue"],
  [/live|run|theat|estate|lifecycle|workflow|agent|deploy|connected|configuration|tool/i, "blue"],
];

export function hueFor(title: string): Hue {
  for (const [re, hue] of RULES) if (re.test(title)) return hue;
  return "slate";
}
