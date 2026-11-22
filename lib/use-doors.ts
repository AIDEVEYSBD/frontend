"use client";

import { useEffect, useState } from "react";

/**
 * Which addresses the platform has built, from its own routers
 * (`GET /api/doors`: `{doors: [{method, path, built}], answered, total}`),
 * read once per page load and shared. A control whose address is not built
 * says so before anyone presses it.
 *
 * Three answers, never two: `true` (built), `false` (the platform lists the
 * address as not built), and `null` (unknown: the list has not been read, the
 * read failed, or the address is not in it). Only `false` may be shown as
 * "not built"; `null` leaves the control as it is, and a press then learns
 * the truth from the answer itself.
 *
 * Paths are compared with every `{name}` part collapsed, since the platform
 * and the console name the same part differently (`{id}`, `{run_id}`).
 */

interface DoorRow {
  method: string;
  path: string;
  built: boolean;
}

const shape = (method: string, path: string) => `${method.toUpperCase()} ${path.split("?")[0].replace(/\{[^}]*\}/g, "{}")}`;

let cached: Map<string, boolean> | null = null;
let inflight: Promise<Map<string, boolean> | null> | null = null;

function read(): Promise<Map<string, boolean> | null> {
  inflight ??= globalThis
    .fetch("/api/doors", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { doors?: unknown } | null) => {
      if (!d || !Array.isArray(d.doors)) return null;
      const map = new Map<string, boolean>();
      for (const row of d.doors as DoorRow[]) {
        if (row && typeof row.method === "string" && typeof row.path === "string") map.set(shape(row.method, row.path), row.built === true);
      }
      cached = map;
      return map;
    })
    .catch(() => null)
    .finally(() => {
      // A failed read is asked again on the next page that needs it; a good one stays for the page's life.
      if (!cached) inflight = null;
    });
  return inflight;
}

/**
 * For a control: `off` when the platform lists its address as not built, with
 * the sentence to show beside it (or on hover). Unknown leaves it on.
 */
export function useDoorOff(method: string, path: string): { off: boolean; why: string | undefined } {
  const built = useDoorBuilt(method, path);
  return built === false ? { off: true, why: `Not built yet: the platform answers 501 to ${method.toUpperCase()} ${path}.` } : { off: false, why: undefined };
}

/** Whether `method path` is built: true, false, or null while unknown. `path` is a template (`/api/runs/{id}/steer`). */
export function useDoorBuilt(method: string, path: string): boolean | null {
  const [map, setMap] = useState<Map<string, boolean> | null>(cached);
  useEffect(() => {
    if (cached) return;
    let live = true;
    void read().then((m) => live && m && setMap(m));
    return () => {
      live = false;
    };
  }, []);
  if (!map) return null;
  const built = map.get(shape(method, path));
  return built === undefined ? null : built;
}
