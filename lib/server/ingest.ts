/**
 * Turning a fetched source into a document.
 *
 * A source is fetched as whatever the publisher serves: an HTML page, a raw
 * markdown file, a CSV feed, a JSON catalogue in OSCAL or STIX, an API
 * listing. Everything is normalised into one light markdown document, with
 * headings, lists and tables preserved, because that is what a person reads
 * in the review, what the section splitter keys off, and what a chunk cites.
 *
 * Nothing is summarised or rewritten: the formatters only carry structure
 * across. A control statement reads as the standard wrote it.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 AgentFactory-KnowledgeBase/1.0";

export const MAX_TEXT = 1_000_000;

/* ── entities ── */

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", copy: "©", reg: "®", trade: "™",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·", deg: "°", euro: "€", pound: "£", sect: "§", para: "¶", times: "×", laquo: "«", raquo: "»",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 9 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/* ── html ── */

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * HTML to markdown by rule.
 *
 * The page's main content is preferred when the page declares one and it is
 * substantial; chrome (navigation, headers, footers, scripts, forms) is
 * dropped; headings, lists, paragraphs, tables, code and emphasis are carried
 * across as markdown. Layout tables, which legal texts use for numbering,
 * collapse to lines when a row has one cell.
 */
export function htmlToMarkdown(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i);
  let title = titleMatch ? stripTags(titleMatch[1]) : "";

  let body = html;
  const main = html.match(/<main[\s>][\s\S]*?<\/main>/i)?.[0] ?? html.match(/<article[\s>][\s\S]*?<\/article>/i)?.[0] ?? "";
  if (main && stripTags(main).split(" ").length > 300) body = main;

  body = body
    .replace(/<head[\s>][\s\S]*?<\/head>/i, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Official Journal texts mark their structure with classes rather than
    // heading tags; carry chapters, sections, annexes and articles across.
    .replace(/<p[^>]*class="[^"]*oj-ti-(?:chapter|section|annex)[^"]*"[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n\n# ${stripTags(t)}\n\n`)
    .replace(/<p[^>]*class="[^"]*oj-ti-(?:art|grseq-1)[^"]*"[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n\n## ${stripTags(t)}\n\n`)
    .replace(/<p[^>]*class="[^"]*oj-sti-art[^"]*"[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n\n### ${stripTags(t)}\n\n`)
    .replace(/<(script|style|noscript|svg|iframe|button|select|textarea|template|canvas|video|audio|object)[\s>][\s\S]*?<\/\1>/gi, " ")
    .replace(/<input[^>]*>/gi, " ")
    .replace(/<(nav|header|footer|aside)[\s>][\s\S]*?<\/\1>/gi, " ")
    .replace(/<img[^>]*>/gi, " ");

  // Block structure first, then inline emphasis, then everything else goes.
  body = body
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, t) => `\n\n${"#".repeat(Number(l))} ${stripTags(t)}\n\n`)
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, t) => `\n\n\`\`\`\n${decodeEntities(t.replace(/<[^>]+>/g, "")).trim()}\n\`\`\`\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => (/\n\n#|<(p|div|table|ul|ol|section)[\s>]/i.test(t) ? `\n\n${t}\n\n` : `\n- ${stripTags(t)}`))
    .replace(/<\/(ul|ol|dl)>/gi, "\n\n")
    .replace(/<dt[^>]*>([\s\S]*?)<\/dt>/gi, (_, t) => `\n\n**${stripTags(t)}**\n`)
    .replace(/<dd[^>]*>([\s\S]*?)<\/dd>/gi, (_, t) => `\n${stripTags(t)}\n`)
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => {
      const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]).replace(/\|/g, "／")).filter((c) => c.length);
      if (!cells.length) return "\n";
      if (cells.length === 1) return `\n${cells[0]}\n`;
      // A label beside a passage is layout, not data: legal texts number
      // recitals and points this way. So is any row too long to be a row.
      if (cells.length === 2 && (cells[0].length <= 16 || cells.some((c) => c.length > 600))) return `\n\n${cells.join(" ")}\n\n`;
      return `\n| ${cells.map((c) => (c.length > 700 ? `${c.slice(0, 700)}…` : c)).join(" | ")} |`;
    })
    .replace(/<\/table>/gi, "\n\n")
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => {
      const s = stripTags(t);
      return s ? ` **${s}** ` : " ";
    })
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => `\n\n> ${stripTags(t)}\n\n`)
    .replace(/<\/(p|div|section|article|blockquote|figure|figcaption|details|summary|main)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n\n");

  let text = decodeEntities(body.replace(/<[^>]+>/g, " "))
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  text = tableRules(text);

  if (!title) {
    const h1 = text.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1].trim();
  }
  return { title, text };
}

/** Insert the header rule markdown tables need, after the first row of each table. */
function tableRules(text: string): string {
  const lines = text.replace(/(\|)\n+(?=\|)/g, "$1\n").split("\n");
  const out: string[] = [];
  let inTable = false;
  for (const line of lines) {
    const isRow = /^\|.*\|$/.test(line);
    if (isRow && !inTable) {
      out.push(line);
      const n = line.split("|").length - 2;
      out.push(`|${" --- |".repeat(Math.max(1, n))}`);
      inTable = true;
      continue;
    }
    if (!isRow) inTable = false;
    out.push(line);
  }
  return out.join("\n");
}

/* ── csv ── */

export function csvToMarkdown(csv: string, maxRows = 400): string {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      if (rows.length > maxRows) break;
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); if (row.some((x) => x.trim())) rows.push(row); }
  if (rows.length < 2) return csv.slice(0, MAX_TEXT);
  const total = csv.split("\n").length - 1;
  const [head, ...body] = rows;
  const shown = body.slice(0, maxRows);
  const clean = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "／").trim().slice(0, 240);
  const lines = [
    `| ${head.map(clean).join(" | ")} |`,
    `|${" --- |".repeat(head.length)}`,
    ...shown.map((r) => `| ${head.map((_, i) => clean(r[i] ?? "")).join(" | ")} |`),
  ];
  const note = total > shown.length + 1 ? `\n\nShowing the ${shown.length} most recent of ${total} entries in the feed.` : "";
  return lines.join("\n") + note;
}

/* ── json: oscal, stix, nvd ── */

interface OscalPart { name?: string; prose?: string; props?: { name: string; value: string }[]; parts?: OscalPart[] }
interface OscalControl { id: string; title: string; params?: { id: string; label?: string; select?: { choice?: string[] } }[]; parts?: OscalPart[]; controls?: OscalControl[] }
interface OscalGroup { id?: string; title: string; controls?: OscalControl[]; groups?: OscalGroup[] }

function oscalProse(prose: string, params: Map<string, string>): string {
  return prose.replace(/\{\{\s*insert:\s*param,\s*([^}\s]+)\s*\}\}/g, (_, id) => `[${params.get(id) ?? "organisation-defined value"}]`);
}

function oscalParts(parts: OscalPart[] | undefined, params: Map<string, string>, depth = 0): string[] {
  const out: string[] = [];
  for (const p of parts ?? []) {
    const label = p.props?.find((x) => x.name === "label")?.value;
    if (p.prose) out.push(`${"  ".repeat(depth)}${label ? `${label} ` : depth ? "- " : ""}${oscalProse(p.prose, params)}`);
    out.push(...oscalParts(p.parts, params, p.prose ? depth + 1 : depth));
  }
  return out;
}

function oscalControl(c: OscalControl, level: number, params: Map<string, string>): string[] {
  for (const p of c.params ?? []) params.set(p.id, p.label ?? (p.select?.choice ? `one of: ${p.select.choice.join("; ")}` : "organisation-defined value"));
  const out = [`${"#".repeat(level)} ${c.id.toUpperCase().replace(/^SP_800_171_/, "")} ${c.title}`];
  const statement = c.parts?.find((p) => p.name === "statement");
  if (statement) {
    const lines = oscalParts([statement], params);
    out.push(lines.join("\n"));
  }
  const guidance = c.parts?.find((p) => p.name === "guidance");
  if (guidance?.prose && level <= 2) out.push(`**Discussion.** ${oscalProse(guidance.prose, params)}`);
  for (const e of c.controls ?? []) out.push(...oscalControl(e, Math.min(level + 1, 4), params));
  return out;
}

export function oscalToMarkdown(doc: { catalog: { metadata?: { title?: string }; groups?: OscalGroup[]; controls?: OscalControl[] } }): { title: string; text: string } {
  const cat = doc.catalog;
  const params = new Map<string, string>();
  const out: string[] = [];
  const group = (g: OscalGroup, level: number) => {
    out.push(`${"#".repeat(level)} ${g.id ? `${g.id.toUpperCase()} ` : ""}${g.title}`);
    for (const c of g.controls ?? []) out.push(...oscalControl(c, level + 1, params));
    for (const sg of g.groups ?? []) group(sg, level + 1);
  };
  for (const g of cat.groups ?? []) group(g, 1);
  for (const c of cat.controls ?? []) out.push(...oscalControl(c, 2, params));
  return { title: cat.metadata?.title ?? "OSCAL catalogue", text: out.join("\n\n") };
}

interface StixObject { type: string; name?: string; description?: string; external_references?: { source_name?: string; external_id?: string; url?: string }[]; kill_chain_phases?: { phase_name: string }[]; x_mitre_shortname?: string; x_mitre_is_subtechnique?: boolean; revoked?: boolean; x_mitre_deprecated?: boolean }

export function stixToMarkdown(bundle: { objects: StixObject[] }): { title: string; text: string } {
  const objs = bundle.objects.filter((o) => !o.revoked && !o.x_mitre_deprecated);
  const idOf = (o: StixObject) => o.external_references?.find((r) => r.external_id)?.external_id ?? "";
  const tactics = objs.filter((o) => o.type === "x-mitre-tactic");
  const techniques = objs.filter((o) => o.type === "attack-pattern");
  const mitigations = objs.filter((o) => o.type === "course-of-action");
  const collection = objs.find((o) => o.type === "x-mitre-collection" || o.type === "x-mitre-matrix");
  const out: string[] = [];
  out.push("# Tactics");
  for (const t of tactics) out.push(`## ${idOf(t)} ${t.name}`, t.description ?? "");
  out.push("# Techniques");
  for (const t of tactics) {
    const mine = techniques.filter((x) => x.kill_chain_phases?.some((k) => k.phase_name === t.x_mitre_shortname));
    if (!mine.length) continue;
    out.push(`## ${t.name}`);
    for (const x of mine) out.push(`### ${idOf(x)} ${x.name}${x.x_mitre_is_subtechnique ? " (sub-technique)" : ""}`, x.description ?? "");
  }
  if (mitigations.length) {
    out.push("# Mitigations");
    for (const m of mitigations) out.push(`## ${idOf(m)} ${m.name}`, m.description ?? "");
  }
  return { title: collection?.name ?? "STIX collection", text: out.join("\n\n") };
}

interface NvdItem { cve: { id: string; published?: string; lastModified?: string; vulnStatus?: string; descriptions?: { lang: string; value: string }[]; metrics?: Record<string, { cvssData?: { baseScore?: number; baseSeverity?: string; vectorString?: string }; baseSeverity?: string }[]>; weaknesses?: { description?: { value: string }[] }[]; references?: { url: string }[] } }

export function nvdToMarkdown(doc: { totalResults?: number; vulnerabilities?: NvdItem[] }): { title: string; text: string } {
  const items = [...(doc.vulnerabilities ?? [])].sort((a, b) => String(b.cve.published ?? "").localeCompare(String(a.cve.published ?? "")));
  const out: string[] = [`# NVD: CVEs published in the last fourteen days`, `${items.length} shown of ${doc.totalResults ?? "?"} published in the window, newest first.`];
  for (const v of items) {
    const c = v.cve;
    const m = c.metrics ?? {};
    const pick = m.cvssMetricV40?.[0] ?? m.cvssMetricV31?.[0] ?? m.cvssMetricV30?.[0] ?? m.cvssMetricV2?.[0];
    const score = pick?.cvssData?.baseScore;
    const sev = pick?.cvssData?.baseSeverity ?? pick?.baseSeverity;
    const cwes = [...new Set((c.weaknesses ?? []).flatMap((w) => (w.description ?? []).map((d) => d.value)).filter((x) => /^CWE-/.test(x)))];
    out.push(
      `## ${c.id}`,
      `| Field | Value |\n| --- | --- |\n| Published | ${(c.published ?? "").slice(0, 10)} |\n| Status | ${c.vulnStatus ?? ""} |\n| CVSS | ${score !== undefined ? `${score} ${sev ?? ""}`.trim() : "not yet scored"} |\n| Vector | ${pick?.cvssData?.vectorString ?? ""} |\n| Weaknesses | ${cwes.join(", ") || "not yet assigned"} |\n| References | ${c.references?.length ?? 0} |`,
      c.descriptions?.find((d) => d.lang === "en")?.value ?? "",
    );
  }
  return { title: "NVD: CVEs published in the last fourteen days", text: out.join("\n\n") };
}

/* ── the fetch ── */

export interface Fetched { title: string; text: string; kind: "html" | "markdown" | "csv" | "json" | "text"; /** The page as served, kept only for link discovery. */ html?: string }

export async function fetchOne(url: string): Promise<Fetched> {
  // The Publications Office serves a document in the representation asked
  // for; the XHTML is the full legal text, so that is what is asked for.
  const cellar = /^https?:\/\/publications\.europa\.eu\//i.test(url);
  if (/^https?:\/\/services\.nvd\.nist\.gov\//i.test(url) && !/pubStartDate=/.test(url)) {
    const end = new Date();
    const start = new Date(end.getTime() - 14 * 86_400_000);
    const stamp = (d: Date) => d.toISOString().slice(0, 19) + ".000";
    url += `${url.includes("?") ? "&" : "?"}pubStartDate=${stamp(start)}&pubEndDate=${stamp(end)}`;
  }
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: cellar ? "application/xhtml+xml" : "text/html,application/json,text/markdown,text/csv,text/plain;q=0.9,*/*;q=0.8",
      "accept-language": cellar ? "en" : "en-GB,en;q=0.9",
    },
    signal: AbortSignal.timeout(45_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const raw = await res.text();
  const lower = url.toLowerCase().split("?")[0];

  if (ct.includes("json") || lower.endsWith(".json")) {
    let j: unknown;
    try { j = JSON.parse(raw); } catch { return { title: "", text: raw.slice(0, MAX_TEXT), kind: "text" }; }
    const o = j as Record<string, unknown>;
    if (o && typeof o === "object" && "catalog" in o) return { ...oscalToMarkdown(o as Parameters<typeof oscalToMarkdown>[0]), kind: "json" };
    if (o && typeof o === "object" && o.type === "bundle" && Array.isArray(o.objects)) return { ...stixToMarkdown(o as Parameters<typeof stixToMarkdown>[0]), kind: "json" };
    if (o && typeof o === "object" && Array.isArray(o.vulnerabilities)) return { ...nvdToMarkdown(o as Parameters<typeof nvdToMarkdown>[0]), kind: "json" };
    return { title: "", text: "```json\n" + JSON.stringify(j, null, 2).slice(0, MAX_TEXT) + "\n```", kind: "json" };
  }
  if (ct.includes("csv") || lower.endsWith(".csv")) return { title: "", text: csvToMarkdown(raw), kind: "csv" };
  if (ct.includes("markdown") || lower.endsWith(".md")) {
    const text = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
    const h1 = text.match(/^#\s+(.+)$/m);
    return { title: h1?.[1].trim() ?? "", text, kind: "markdown" };
  }
  if (raw.trimStart().startsWith("<") || ct.includes("html")) return { ...htmlToMarkdown(raw), kind: "html", html: raw };
  return { title: "", text: raw.slice(0, MAX_TEXT), kind: "text" };
}

/* ── expansion: everything the source has, not just its front page ── */

/**
 * The child pages an index page links to, under its own path.
 *
 * A "Top 10" front page is a table of contents; the substance is one page
 * per entry. Links are followed only within the same origin and directory,
 * only to pages (no files, anchors or queries), and only up to a bound, so
 * a site map cannot turn one fetch into a crawl.
 */
export const MAX_PAGES = 40;

export function childLinks(indexUrl: string, html: string): string[] {
  let base: URL;
  try {
    base = new URL(indexUrl);
  } catch {
    return [];
  }
  const dir = base.pathname.replace(/[^/]*$/, "");
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#?]+)["']/gi)) {
    let u: URL;
    try {
      u = new URL(m[1], base);
    } catch {
      continue;
    }
    if (u.origin !== base.origin) continue;
    if (!u.pathname.startsWith(dir) || u.pathname === base.pathname) continue;
    if (/\.(pdf|png|jpe?g|gif|svg|zip|xml|css|js|ico|webp|mp4)$/i.test(u.pathname)) continue;
    // One level down only: a section's own children, not the whole site.
    const rest = u.pathname.slice(dir.length).replace(/\/$/, "");
    if (!rest || rest.split("/").length > 2) continue;
    const key = `${u.origin}${u.pathname.replace(/\/$/, "")}`;
    if (!seen.has(key)) seen.add(key);
  }
  return [...seen].slice(0, MAX_PAGES);
}

/* ── cleaning: what would clog the index and never answer a question ── */

export interface Cleaning {
  /** Lines that were site chrome: cookie notices, share bars, breadcrumbs, menus. */
  chrome: number;
  /** Paragraphs that appeared on more than half the pages fetched. */
  boilerplate: number;
  /** Paragraphs repeated within the document. */
  duplicates: number;
  /** Fragments too short to carry a claim. */
  fragments: number;
  /** Characters before and after. */
  before: number;
  after: number;
}

const CHROME = /^(skip to (main )?content|cookie|we use cookies|accept all( cookies)?|reject all|manage (cookies|preferences)|privacy (policy|settings)|share (this|on)|tweet|follow us|subscribe|sign in|log in|log out|register|search\.{0,3}|menu|toggle navigation|back to top|print( this)? page|last updated|©|copyright|all rights reserved|terms of (use|service)|breadcrumbs?|home\s*[›>»/]|previous|next|edit (this )?page|report an? (issue|problem)|table of contents|on this page|related (articles|links|content)|was this (page )?helpful)/i;

function isChrome(line: string): boolean {
  const t = line.replace(/^[-*]\s+/, "").replace(/\*\*/g, "").trim();
  if (!t) return false;
  if (CHROME.test(t)) return true;
  // A run of very short link-like lines is a menu, not a passage.
  return false;
}

/** Strip a document of chrome, boilerplate, repeats and fragments. Structure (headings, tables, code) is left alone. */
export function clean(parts: string[]): { parts: string[]; cleaning: Cleaning } {
  const before = parts.reduce((s, p) => s + p.length, 0);
  const c: Cleaning = { chrome: 0, boilerplate: 0, duplicates: 0, fragments: 0, before, after: 0 };

  // Paragraph frequency across pages: what every page carries is the site, not the source.
  const norm = (p: string) => p.replace(/\s+/g, " ").trim().toLowerCase();
  const freq = new Map<string, number>();
  const split = parts.map((p) => p.split(/\n{2,}/));
  if (parts.length > 2) {
    for (const paras of split) for (const p of new Set(paras.map(norm))) if (p.length > 20) freq.set(p, (freq.get(p) ?? 0) + 1);
  }
  const shared = (p: string) => parts.length > 2 && (freq.get(norm(p)) ?? 0) > parts.length / 2 && !/^#{1,6}\s/.test(p.trim());

  const seen = new Set<string>();
  const out = split.map((paras) => {
    const kept: string[] = [];
    for (const para of paras) {
      const t = para.trim();
      if (!t) continue;
      const structural = /^#{1,6}\s/.test(t) || t.startsWith("|") || t.startsWith("```") || t.startsWith("> ");
      if (!structural) {
        // Menus arrive as a paragraph of short list items or bare short lines.
        const lines = t.split("\n");
        const chromeLines = lines.filter(isChrome).length;
        if (chromeLines && chromeLines >= Math.ceil(lines.length / 2)) {
          c.chrome += 1;
          continue;
        }
        const listish = lines.length >= 4 && lines.every((l) => l.replace(/^[-*]\s+/, "").trim().length <= 40 && !/[.:;]$/.test(l.trim()));
        if (listish && !/^\d/.test(t)) {
          c.chrome += 1;
          continue;
        }
        if (shared(t)) {
          c.boilerplate += 1;
          continue;
        }
        const words = t.split(/\s+/).length;
        if (words < 4 && t.length < 24 && !/\d/.test(t)) {
          c.fragments += 1;
          continue;
        }
        const key = norm(t);
        if (key.length > 60) {
          if (seen.has(key)) {
            c.duplicates += 1;
            continue;
          }
          seen.add(key);
        }
      }
      kept.push(t);
    }
    return kept.join("\n\n");
  });
  c.after = out.reduce((s, p) => s + p.length, 0);
  return { parts: out, cleaning: c };
}

/**
 * Fetch everything a source has: every URL it names (space separated), and
 * for a single HTML index page the child pages it links to under its own
 * path. Parts are cleaned and joined into one document, each under its own
 * heading when there is more than one, and the record says what was
 * fetched and what was removed, so the person reviewing it sees both.
 */
export async function fetchSource(urls: string, fallbackTitle: string): Promise<{ title: string; text: string; parts: number; pages: string[]; cleaning: Cleaning; expanded: boolean }> {
  const list = urls.split(/\s+/).map((u) => u.trim()).filter(Boolean);
  if (!list.length) throw new Error("the source has no URL to fetch");
  const fetched: (Fetched & { url: string })[] = [];
  for (const u of list) fetched.push({ ...(await fetchOne(u)), url: u });

  // Expansion: one HTML page that is a table of contents for its own section.
  let expanded = false;
  if (list.length === 1 && fetched[0].kind === "html" && fetched[0].html) {
    const children = childLinks(list[0], fetched[0].html);
    if (children.length >= 3) {
      const got = await Promise.all(
        children.map(async (u) => {
          try {
            const f = await fetchOne(u);
            return f.kind === "html" && f.text.split(/\s+/).length >= 120 ? { ...f, url: u } : null;
          } catch {
            return null;
          }
        }),
      );
      const ok = got.filter((x): x is Fetched & { url: string } => x !== null);
      if (ok.length >= 3) {
        fetched.push(...ok);
        expanded = true;
      }
    }
  }

  const usable = (t: string) => t && /\s/.test(t.trim()) && !/\.(xml|html?|pdf|json|csv|md)$/i.test(t.trim());
  const { parts, cleaning } = clean(fetched.map((p) => p.text));
  const pages = fetched.map((p) => p.url);
  if (fetched.length === 1) {
    return { title: usable(fetched[0].title) ? fetched[0].title : fallbackTitle, text: parts[0].slice(0, MAX_TEXT), parts: 1, pages, cleaning, expanded };
  }
  const text = parts
    .map((p, i) => (p.startsWith("#") ? p : `# ${fetched[i].title || "Part"}\n\n${p}`))
    .join("\n\n")
    .slice(0, MAX_TEXT);
  return { title: expanded && usable(fetched[0].title) ? fetched[0].title : fallbackTitle, text, parts: fetched.length, pages, cleaning, expanded };
}
