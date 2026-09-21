"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A small markdown renderer for what the platform produces and fetches:
 * headings, paragraphs, lists, tables, code, quotes, bold, inline code and
 * links. No HTML passes through. Headings get stable ids when asked, so a
 * table of contents can scroll to them.
 */

export function DataTable({ columns, rows, dense = false, cite }: { columns: string[]; rows: string[][]; dense?: boolean; cite?: Cite }) {
  return (
    <div className="my-1.5 overflow-x-auto rounded-md border border-line">
      <table className={`w-full border-collapse text-left ${dense ? "text-[11px]" : "text-[11.5px]"}`}>
        <thead>
          <tr className="border-b border-line bg-raise/60 text-[10.5px] text-faint">
            {columns.map((c, i) => (
              <th key={i} className="px-2.5 py-1.5 font-medium whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {columns.map((_, j) => (
                <td key={j} className={`px-2.5 py-1.5 align-top ${/^[\d.,%£$€ ]+[kM]?$/.test(r[j] ?? "") ? "tnum font-mono text-[11px] text-dim whitespace-nowrap" : "text-fg"}`}>{inline(r[j] ?? "", `c${i}-${j}`, cite)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Render a numbered citation marker such as [3]; when given, `[n]` tokens become what it returns. */
export type Cite = (n: number, key: string) => ReactNode;

export function inline(text: string, keyBase: string, cite?: Cite): ReactNode[] {
  const out: ReactNode[] = [];
  const re = cite ? /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|\[\d{1,3}\])/g : /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    const cm = cite ? /^\[(\d{1,3})\]$/.exec(tok) : null;
    if (cm) out.push(<span key={k}>{cite!(Number(cm[1]), k)}</span>);
    else if (tok.startsWith("**")) out.push(<strong key={k} className="font-semibold">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="rounded-sm bg-raise px-1 font-mono text-[11px]">{tok.slice(1, -1)}</code>);
    else {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      const href = mm[2];
      out.push(
        href.startsWith("/") ? (
          <Link key={k} href={href} className="focusable underline decoration-line-strong underline-offset-2 hover:decoration-fg">{mm[1]}</Link>
        ) : (
          <a key={k} href={href} target="_blank" rel="noreferrer" className="focusable underline decoration-line-strong underline-offset-2 hover:decoration-fg">{mm[1]}</a>
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST = /^\s*([-*•]|\d+[.)])\s+/;
const ROW = /^\s*\|.*\|\s*$/;
const RULE = /^\s*\|?\s*:?-{2,}/;

export function Markdown({
  text,
  headingIds = false,
  fence,
  cite,
}: {
  text: string;
  headingIds?: boolean;
  /** Render a fenced block with a given language yourself; return null to fall back to a code block. */
  fence?: (lang: string, code: string, closed: boolean) => ReactNode | null;
  /** Render `[n]` citation markers. */
  cite?: Cite;
}) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let i = 0;
  let b = 0;
  let h = 0;
  const HEADING = ["text-[17px] font-semibold tracking-[-0.01em]", "text-[15px] font-semibold tracking-[-0.005em]", "text-[13.5px] font-semibold", "text-[12.5px] font-semibold", "text-[12px] font-semibold", "text-[12px] font-medium"];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim().toLowerCase();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      const closed = i < lines.length;
      i++;
      const custom = fence?.(lang, code.join("\n"), closed);
      if (custom !== null && custom !== undefined) { blocks.push(<div key={b++}>{custom}</div>); continue; }
      blocks.push(<pre key={b++} className="my-1.5 overflow-x-auto rounded-sm border border-line bg-raise px-2 py-1.5 font-mono text-[11px] leading-[1.5]">{code.join("\n")}</pre>);
      continue;
    }
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      const level = hm[1].length;
      const id = headingIds ? `md-h-${h++}` : undefined;
      blocks.push(<p key={b++} id={id} className={`mt-3 mb-1 scroll-mt-3 first:mt-0 ${HEADING[level - 1]}`}>{inline(hm[2], `h${b}`, cite)}</p>);
      i++;
      continue;
    }
    if (ROW.test(line) && i + 1 < lines.length && RULE.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const columns = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && ROW.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(<DataTable key={b++} columns={columns} rows={rows} dense={columns.length > 4} cite={cite} />);
      continue;
    }
    if (line.startsWith("> ")) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) q.push(lines[i++].slice(2));
      blocks.push(<blockquote key={b++} className="my-1.5 border-l-2 border-line-strong pl-3 text-faint">{inline(q.join(" "), `q${b}`, cite)}</blockquote>);
      continue;
    }
    if (LIST.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      while (i < lines.length && LIST.test(lines[i])) items.push(lines[i++].replace(LIST, ""));
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={b++} className={`my-1 flex flex-col gap-0.5 pl-4 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it, k) => <li key={k}>{inline(it, `li${b}-${k}`, cite)}</li>)}
        </Tag>,
      );
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && !lines[i].startsWith("```") && !/^#{1,6}\s/.test(lines[i]) && !ROW.test(lines[i]) && !lines[i].startsWith("> ")) para.push(lines[i++]);
    blocks.push(<p key={b++} className="my-1 first:mt-0 last:mb-0">{inline(para.join(" "), `p${b}`, cite)}</p>);
  }
  return <>{blocks}</>;
}

/** The headings of a markdown text, in order, with the ids `Markdown` assigns. */
export function headingsOf(text: string): { id: string; level: number; text: string }[] {
  const out: { id: string; level: number; text: string }[] = [];
  let h = 0;
  let inFence = false;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (line.startsWith("```")) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) out.push({ id: `md-h-${h++}`, level: m[1].length, text: m[2].replace(/\*\*/g, "") });
  }
  return out;
}
