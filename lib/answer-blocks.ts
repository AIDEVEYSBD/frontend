/**
 * Answers as blocks: the one vocabulary both chats answer in, mirrored from
 * the service (agentfactory/answers/blocks.py in the backend).
 *
 * An answer is `{text, blocks, followups}`. The console assistant's blocks are
 * filled by the service from reads it made in the same turn and name them in
 * `source`; a registered chatbot's blocks hold the chatbot's own words and
 * carry no source. The service validates every block before it sends it; a
 * block it refused arrives in `refused` with the reason.
 *
 * `answerOf` reads what arrived field by field. A block of a type this console
 * does not draw, or one whose shape is not the vocabulary's, is not dropped:
 * it becomes a refusal saying so, shown where the block would have been.
 */

import { consolePath } from "./safe-link";

export type BlockFormat = "text" | "number" | "usd" | "time" | "id";
export type Value = string | number | boolean | null;

/** The reads a block of the console assistant was filled from, and a note on what they cover (a list cut, values missing). */
export interface BlockSource {
  reads: { id: string; read: string; arguments: Record<string, unknown>; at: string }[];
  note: string | null;
}

interface Common {
  title: string | null;
  source: BlockSource | null;
}

export interface TilesBlock extends Common {
  type: "tiles";
  items: { label: string; value: Value; format: BlockFormat | null; href: string | null }[];
}
export interface TableBlock extends Common {
  type: "table";
  columns: { label: string; format: BlockFormat | null }[];
  rows: { cells: Value[]; href: string | null }[];
  /** Rows in all, when more exist than are shown; null otherwise. */
  total: number | null;
}
export interface BarsBlock extends Common {
  type: "bars";
  items: { label: string; value: number | null; href: string | null }[];
  format: BlockFormat | null;
}
export interface ChartBlock extends Common {
  type: "chart";
  x: string[];
  series: { label: string; values: (number | null)[] }[];
  format: BlockFormat | null;
}
export interface StepsBlock extends Common {
  type: "steps";
  steps: { label: string; detail: string | null; state: string | null; at: string | null }[];
}
export interface LinksBlock extends Common {
  type: "links";
  links: { label: string; href: string }[];
}
export interface ChoicesBlock extends Common {
  type: "choices";
  options: string[];
}
export type Block = TilesBlock | TableBlock | BarsBlock | ChartBlock | StepsBlock | LinksBlock | ChoicesBlock;

/** A block the service refused (and the model did not correct), or one this console could not read: shown with the reason. */
export interface RefusedBlock {
  block: string;
  reason: string;
}

export interface Answer {
  text: string;
  blocks: Block[];
  followups: string[];
  refused: RefusedBlock[];
  /** A chatbot's answer: the reply format the model endpoint took ("json_schema"), or the form it was asked again in when it refused the schema. */
  replyFormat: string | null;
}

/** Who wrote the blocks: the platform, from its records (the console assistant), or a registered chatbot, in its own words. */
export type Origin = { kind: "platform" } | { kind: "chatbot"; name: string };

/* ═══════════════════ reading what arrived ═══════════════════ */

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const FORMATS: BlockFormat[] = ["text", "number", "usd", "time", "id"];
const fmtOf = (v: unknown): BlockFormat | null => (FORMATS.includes(v as BlockFormat) ? (v as BlockFormat) : null);
const valueOf = (v: unknown): Value => (typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
// Only a page inside the console, resolved (lib/safe-link.ts): never another site or a scheme, and not `/\host`, which a browser reads as `//host`.
const hrefOf = (v: unknown): string | null => consolePath(v);

class Unreadable extends Error {}

function need(ok: boolean, why: string): void {
  if (!ok) throw new Unreadable(why);
}

function sourceOf(v: unknown): BlockSource | null {
  if (v === null || v === undefined) return null;
  const s = rec(v);
  return {
    reads: arr(s.reads).map((r) => {
      const x = rec(r);
      return { id: str(x.id), read: str(x.read), arguments: rec(x.arguments), at: str(x.at) };
    }),
    note: strOrNull(s.note),
  };
}

function blockOf(v: unknown): Block {
  const b = rec(v);
  const common = { title: strOrNull(b.title), source: sourceOf(b.source) };
  switch (b.type) {
    case "tiles": {
      const items = arr(b.items).map((i) => {
        const x = rec(i);
        return { label: str(x.label), value: valueOf(x.value), format: fmtOf(x.format), href: hrefOf(x.href) };
      });
      need(items.length > 0, "a tiles block with no tiles");
      return { type: "tiles", ...common, items };
    }
    case "table": {
      const columns = arr(b.columns).map((c) => ({ label: str(rec(c).label), format: fmtOf(rec(c).format) }));
      const rows = arr(b.rows).map((r) => ({ cells: arr(rec(r).cells).map(valueOf), href: hrefOf(rec(r).href) }));
      need(columns.length > 0 && rows.every((r) => r.cells.length === columns.length), "a table whose rows do not match its columns");
      return { type: "table", ...common, columns, rows, total: numOrNull(b.total) };
    }
    case "bars": {
      const items = arr(b.items).map((i) => ({ label: str(rec(i).label), value: numOrNull(rec(i).value), href: hrefOf(rec(i).href) }));
      need(items.length > 0, "a bars block with no bars");
      return { type: "bars", ...common, items, format: fmtOf(b.format) };
    }
    case "chart": {
      const x = arr(b.x).map(str);
      const series = arr(b.series).map((s) => ({ label: str(rec(s).label), values: arr(rec(s).values).map(numOrNull) }));
      need(x.length >= 2 && series.length >= 1 && series.length <= 2 && series.every((s) => s.values.length === x.length), "a chart whose series do not match its points");
      return { type: "chart", ...common, x, series, format: fmtOf(b.format) };
    }
    case "steps": {
      const steps = arr(b.steps).map((s) => {
        const x = rec(s);
        return { label: str(x.label), detail: strOrNull(x.detail), state: strOrNull(x.state), at: strOrNull(x.at) };
      });
      need(steps.length > 0, "a steps block with no steps");
      return { type: "steps", ...common, steps };
    }
    case "links": {
      const links = arr(b.links).map((l) => ({ label: str(rec(l).label), href: hrefOf(rec(l).href) ?? "" }));
      need(links.length > 0 && links.every((l) => l.href), "a links block with a link outside the console");
      return { type: "links", ...common, links };
    }
    case "choices": {
      const options = arr(b.options).map(str).filter(Boolean);
      need(options.length > 0, "a choices block with no choices");
      return { type: "choices", ...common, options };
    }
    default:
      throw new Unreadable(`a block of type "${String(b.type)}", which this console does not draw`);
  }
}

/** An answer as the service sent it; null when nothing that looks like one arrived (a text reply). */
export function answerOf(v: unknown): Answer | null {
  if (!v || typeof v !== "object") return null;
  const a = rec(v);
  const blocks: Block[] = [];
  const refused: RefusedBlock[] = arr(a.refused).map((r) => ({ block: str(rec(r).block) || "block", reason: str(rec(r).reason) || "no reason was given" }));
  arr(a.blocks).forEach((raw, i) => {
    try {
      blocks.push(blockOf(raw));
    } catch (e) {
      refused.push({ block: str(rec(raw).type) || `block ${i + 1}`, reason: `The console could not draw it: ${(e as Error).message}.` });
    }
  });
  return { text: str(a.text), blocks, followups: arr(a.followups).map(str).filter(Boolean), refused, replyFormat: strOrNull(a.reply_format) };
}

/** The read a source names, in words: its name and the arguments it was made with. */
export function readWords(r: BlockSource["reads"][number]): string {
  const args = Object.entries(r.arguments).filter(([, v]) => v !== "" && v !== null && v !== undefined);
  return args.length ? `${r.read} (${args.map(([k, v]) => `${k} ${String(v)}`).join(", ")})` : r.read;
}
