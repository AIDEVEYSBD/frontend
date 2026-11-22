"use client";

import { useEffect, useState } from "react";
import { ask, type Answer } from "./api/pending";
import { notBuiltOf } from "./not-built";

/**
 * Whether this deployment enforces each control of the catalogue now, and how
 * often each has fired, as the platform answers `GET /api/controls`. Read once
 * per page load and shared by every screen that shows a control's status (the
 * Catalogue, the baseline policies, controls in force for one agent).
 *
 * Every figure is the answer's. A control the answer does not list is "not
 * reported"; an enforcement state given as null is "unknown", with the
 * answer's reason; a firing count given as null is "unknown" with the
 * answer's reason (`firings_why`, else the control's `evidence` line, which
 * says why no journal entry names it). Until the address answers, nothing is
 * said about enforcement either way, and the screens say the address is not
 * built or failed.
 *
 * The answer, per control (agentfactory api/routes/guardrails.py `get_controls`):
 *   controls[].id                    the catalogue id (AF-AC-01 ...)
 *   controls[].enforcement.state     "enforced", "partly", "not_enforced", or null (unknown)
 *   controls[].enforcement.why       what it rests on, why not, or why it is unknown
 *   controls[].enforcement.facts[]   {path, fact, holds, said}: each fact read
 *   controls[].firings               journal entries naming it, or null (it acts outside a run)
 *   controls[].evidence              one line on what the count is, or why there is none
 *   not_built                        a map of field to reason
 */

export type EnforcementState = "enforced" | "partly" | "not_enforced" | null;

export interface ControlStatus {
  id: string;
  state: EnforcementState;
  why: string;
  facts: { path: string; fact: string; holds: boolean | null; said: string }[];
  fired: number | null;
  /** Why the count is not known, when `fired` is null. */
  firedWhy: string;
}

export type ControlsRead = { state: "ok"; byId: Map<string, ControlStatus>; notBuilt: string[] } | Exclude<Answer<unknown>, { state: "ok" }>;

const STATES = new Set(["enforced", "partly", "not_enforced"]);

function statusOf(v: unknown): ControlStatus | null {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  if (!o || typeof o.id !== "string" || !o.id) return null;
  const e = o.enforcement && typeof o.enforcement === "object" ? (o.enforcement as Record<string, unknown>) : {};
  const state = typeof e.state === "string" && STATES.has(e.state) ? (e.state as EnforcementState) : null;
  const why = typeof e.why === "string" && e.why ? e.why : state === null ? "the answer gives no reason" : "";
  const facts = (Array.isArray(e.facts) ? e.facts : [])
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object")
    .map((f) => ({ path: String(f.path ?? ""), fact: String(f.fact ?? ""), holds: f.holds === true ? true : f.holds === false ? false : null, said: String(f.said ?? "") }));
  const fired = typeof o.firings === "number" && Number.isFinite(o.firings) ? o.firings : null;
  const firedWhy = fired !== null ? "" : typeof o.firings_why === "string" && o.firings_why ? o.firings_why : typeof o.evidence === "string" && o.evidence ? o.evidence : "the answer gives no reason";
  return { id: o.id, state, why, facts, fired, firedWhy };
}

let shared: Promise<ControlsRead> | null = null;

export function readControls(): Promise<ControlsRead> {
  shared ??= ask<unknown>("controls").then((a): ControlsRead => {
    if (a.state !== "ok") return a;
    const body = a.data && typeof a.data === "object" ? (a.data as Record<string, unknown>) : {};
    if (!Array.isArray(body.controls)) return { state: "error", message: "GET /api/controls answered without a list of controls" };
    const byId = new Map<string, ControlStatus>();
    for (const row of body.controls) {
      const st = statusOf(row);
      if (st) byId.set(st.id, st);
    }
    return { state: "ok", byId, notBuilt: notBuiltOf(body) };
  });
  void shared.then((r) => {
    // A failed read is asked again by the next screen that needs it; a good one (or "not built") stays for the page's life.
    if (r.state === "error") shared = null;
  });
  return shared;
}

/** The controls answer, or null while it is being read. */
export function useControls(): ControlsRead | null {
  const [got, setGot] = useState<ControlsRead | null>(null);
  useEffect(() => {
    let live = true;
    void readControls().then((r) => live && setGot(r));
    return () => {
      live = false;
    };
  }, []);
  return got;
}

/** One control's enforcement in words and tone, from the answer only; null while the answer is not in. */
export function enforcementOf(read: ControlsRead | null, id: string): { label: string; tone: "ok" | "neutral" | "warn"; why: string; state: EnforcementState | "absent" } | null {
  if (!read || read.state !== "ok") return null;
  const st = read.byId.get(id);
  if (!st) return { label: "not reported", tone: "warn", why: "The platform's answer does not list this control.", state: "absent" };
  if (st.state === "enforced") return { label: "enforced now", tone: "ok", why: st.why, state: st.state };
  if (st.state === "partly") return { label: "partly enforced", tone: "warn", why: st.why, state: st.state };
  if (st.state === "not_enforced") return { label: "not enforced", tone: "neutral", why: st.why, state: st.state };
  return { label: "unknown", tone: "warn", why: st.why, state: null };
}
