"use client";

import { useEffect, useState } from "react";
import { CONTROLS, STANDARDS, type Control } from "@/lib/guardrails";
import { GROUPINGS, type Domain } from "@/lib/control-domains";
import { QUIET } from "@/lib/quiet";
import type { Compliance, ControlCustom, IclControl } from "@/lib/api/pending";

/**
 * What the Compliance view counts from, and nothing that holds a record.
 *
 * The standards are read from two places that already exist: the five the
 * catalogue cites (lib/guardrails.ts, `references` on each control) and the
 * three it is grouped under (lib/control-domains.ts, one domain per control).
 * No citation is written here. The ABB ICL is the client's list and comes
 * only from the `compliance` door.
 */

/** The client's own control list, named as the client names it. */
export const ICL = "ABB ICL";
/** The ICL's id among the standards, for the filter and the coverage row. */
export const ICL_ID = "icl";

export interface Entry {
  ref: string;
  name: string;
}

export interface StandardCol {
  id: string;
  short: string;
  /** The standard's full title. */
  title: string;
  /** What the catalogue says about why it is here, when it says anything. */
  note?: string;
  /** Cited: a control names the entries it answers. Grouped: each control sits under one domain. */
  kind: "cited" | "grouped";
  entries: (c: Control) => Entry[];
}

/** A domain's code as its own name writes it ("AC · Access Control", "A.8 · Technological controls"), or its id. */
function domainEntry(d: Domain): Entry {
  const at = d.name.indexOf(" · ");
  if (at > 0) return { ref: d.name.slice(0, at), name: d.name.slice(at + 3) };
  return { ref: d.id, name: d.note ? `${d.name}: ${d.note}` : d.name };
}

export const STANDARD_COLS: StandardCol[] = [
  ...STANDARDS.map(
    (s): StandardCol => ({
      id: s.std,
      short: s.std,
      title: s.title,
      note: s.note,
      kind: "cited",
      entries: (c) => c.references.filter((r) => r.std === s.std).map((r) => ({ ref: r.ref, name: r.name })),
    }),
  ),
  ...GROUPINGS.map(
    (g): StandardCol => ({
      id: g.id,
      short: g.short,
      title: g.label,
      kind: "grouped",
      entries: (c) => {
        const d = g.domains.find((x) => x.id === g.of[c.id]);
        return d ? [domainEntry(d)] : [];
      },
    }),
  ),
];

/* ═══════════════════ what a deployment changed ═══════════════════ */

/** A change as it is kept: trimmed, and nothing at all when it says only "applies". */
export function tidyCustom(c: ControlCustom | null | undefined): ControlCustom | null {
  if (!c) return null;
  const note = c.note?.trim() || undefined;
  const owner = c.owner?.trim() || undefined;
  if (c.applies !== false && !note && !owner) return null;
  return { applies: c.applies !== false, ...(note ? { note } : {}), ...(owner ? { owner } : {}) };
}

export function sameCustom(a: ControlCustom | null | undefined, b: ControlCustom | null | undefined): boolean {
  const x = tidyCustom(a);
  const y = tidyCustom(b);
  if (!x || !y) return x === y;
  return x.applies === y.applies && (x.note ?? "") === (y.note ?? "") && (x.owner ?? "") === (y.owner ?? "");
}

export function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** The record as the door gave it, with every part present whatever was sent. */
export function readCompliance(data: Compliance | null | undefined): { icl: Compliance["icl"]; mapping: Record<string, string[]>; custom: Record<string, ControlCustom> } {
  const d = data && typeof data === "object" ? data : null;
  const icl = d?.icl && typeof d.icl === "object" && Array.isArray(d.icl.controls) ? d.icl : null;
  const mapping: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(d?.mapping && typeof d.mapping === "object" ? d.mapping : {})) if (Array.isArray(v)) mapping[k] = v.filter((x) => typeof x === "string");
  const custom: Record<string, ControlCustom> = {};
  for (const [k, v] of Object.entries(d?.custom && typeof d.custom === "object" ? d.custom : {})) if (v && typeof v === "object") custom[k] = v;
  return { icl, mapping, custom };
}

/* ═══════════════════ coverage ═══════════════════ */

export interface Coverage {
  /** Controls of the catalogue that apply to this deployment. */
  applying: Control[];
  /** How many catalogue controls are marked as not applying. */
  left: number;
  /** Per standard: how many of the applying controls have an entry in it. */
  byStandard: Map<string, number>;
  /** The ICL figures, or null while no list is loaded. */
  icl: { mapped: number; total: number; gaps: IclControl[] } | null;
}

export function coverage(mappingOf: (id: string) => string[], customOf: (id: string) => ControlCustom | null, list: IclControl[] | null): Coverage {
  const applying = CONTROLS.filter((c) => customOf(c.id)?.applies !== false);
  const byStandard = new Map(STANDARD_COLS.map((s) => [s.id, applying.filter((c) => s.entries(c).length > 0).length]));
  let icl: Coverage["icl"] = null;
  if (list) {
    const known = new Set(list.map((x) => x.id));
    const answered = new Set(applying.flatMap((c) => mappingOf(c.id)));
    icl = {
      mapped: applying.filter((c) => mappingOf(c.id).some((id) => known.has(id))).length,
      total: list.length,
      gaps: list.filter((x) => !answered.has(x.id)),
    };
  }
  return { applying, left: CONTROLS.length - applying.length, byStandard, icl };
}

/* ═══════════════════ firings ═══════════════════ */

/** The part of the console's own `/api/guardrails` record this view counts from. */
interface FiringRecord {
  runs: number;
  counts: Record<string, number>;
  posture: { agents: number };
}

/**
 * The record the Catalogue tab reads, by the same call and the same rules
 * (components/guardrails.tsx): an answer that is not the record is a failed
 * read; a quiet console with no run and no deployed workflow has no record to
 * count from, so nothing is drawn as zero.
 */
export function useFirings(): { record: FiringRecord | null; failed: boolean; noRecord: boolean; fired: (c: Control) => number | null } {
  const [record, setRecord] = useState<FiringRecord | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stop = false;
    fetch("/api/guardrails")
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as FiringRecord | null;
        if (!r.ok || !d || typeof d.counts !== "object" || !d.posture) throw new Error("no record");
        if (!stop) setRecord(d);
      })
      .catch(() => !stop && setFailed(true));
    return () => {
      stop = true;
    };
  }, []);
  // A control is counted under its journal key and under its catalogue id, as the Catalogue tab counts it.
  const fired = (c: Control) => {
    if (c.journal === "—") return null;
    const keys = c.journal === c.id ? [c.id] : [c.journal, c.id];
    return keys.reduce((n, k) => n + (record?.counts?.[k] ?? 0), 0);
  };
  const noRecord = QUIET && (failed || (record !== null && record.runs === 0 && record.posture.agents === 0));
  return { record, failed, noRecord, fired };
}

/* ═══════════════════ the list file ═══════════════════ */

/** One CSV text as rows of fields: quoted fields, doubled quotes and line breaks inside quotes are read. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

export interface ListCheck {
  /** Columns the header row lacks, of the ones a list must have. */
  missing: string[];
  hasDomain: boolean;
  controls: number;
  domains: number;
  /** Rows with no id. */
  blank: number;
  /** Ids that appear on more than one row. */
  repeated: number;
}

/** What a chosen file holds, read in the browser before anything is sent. */
export function checkList(text: string): ListCheck {
  const rows = csvRows(text);
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const at = { id: head.indexOf("id"), title: head.indexOf("title"), domain: head.indexOf("domain") };
  const missing = (["id", "title"] as const).filter((k) => at[k] < 0);
  const body = rows.slice(1);
  const ids = at.id < 0 ? [] : body.map((r) => (r[at.id] ?? "").trim());
  const seen = new Set<string>();
  let repeated = 0;
  for (const id of ids) {
    if (!id) continue;
    if (seen.has(id)) repeated++;
    seen.add(id);
  }
  return {
    missing,
    hasDomain: at.domain >= 0,
    controls: seen.size,
    domains: at.domain < 0 ? 0 : new Set(body.map((r) => (r[at.domain] ?? "").trim()).filter(Boolean)).size,
    blank: ids.filter((id) => !id).length,
    repeated,
  };
}

/* ═══════════════════ small shared pieces ═══════════════════ */

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

/** A clause, domain or ICL id as the matrix writes it; the entry's name is on hover. */
export function EntryChip({ entry, standard }: { entry: Entry; standard: string }) {
  return (
    <span title={`${standard} ${entry.ref}: ${entry.name}`} className="rounded-sm border border-line bg-raise px-1.5 py-px font-mono text-[10.5px] leading-[16px] whitespace-nowrap text-dim">
      {entry.ref}
    </span>
  );
}
