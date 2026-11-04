import type { Tone } from "@/components/ui";
import type { BomModel, BomTool } from "./api/l9";

/**
 * Data classes and the AI-BOM in words (phase L9). A tool or source declares
 * the class of what it returns; a sink or peer the highest class it takes.
 * Content carries its class like taint, and a sink whose limit is lower
 * refuses it (`control: data_class`). Pure.
 */

export const DATA_CLASSES = ["public", "internal", "confidential", "restricted"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export const DATA_CLASS_TONE: Record<string, Tone> = { public: "neutral", internal: "neutral", confidential: "warn", restricted: "err" };

export const dataClassChoices = (none: string): { value: string; label: string }[] => [{ value: "", label: none }, ...DATA_CLASSES.map((c) => ({ value: c, label: c }))];

/** How a model was chosen, in words. */
export function chosenLine(m: Pick<BomModel, "chosen_by">): string {
  return m.chosen_by.map((c) => (c.startsWith("tier:") ? `model class ${c.slice(5)}` : c === "node_route" ? "a node route" : c === "node" ? "the node" : c)).join(", ");
}

export const modelLine = (m: BomModel): string => {
  const r = m.route;
  if (!r) return "no route on record";
  return [r.provider || r.kind, r.served_as ? `served as ${r.served_as}` : "", r.endpoint].filter(Boolean).join(" · ");
};

/** Which impact tags a tool carries, in words: `ot_read` reads replicated data only. */
export const impactLine = (t: Pick<BomTool, "impact">): string => t.impact.map((i) => (i === "ot_read" ? "reads replicated OT data only" : i.replace(/_/g, " "))).join(", ");

/** The classes a tool's row shows: what it reads and what it takes. */
export function classLines(t: Pick<BomTool, "data_class" | "max_data_class" | "sink">): { reads: string; takes: string } {
  return { reads: t.data_class || "undeclared", takes: t.sink ? t.max_data_class || "no limit declared" : "" };
}
