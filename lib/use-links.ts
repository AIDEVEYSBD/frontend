"use client";

import { useEffect, useState } from "react";
import type { ConsoleLinks } from "@/app/api/links/route";

/**
 * The addresses of the consoles this one hands off to (app/api/links/route.ts),
 * read once and shared. `null` until the answer is in; an address a deployment
 * has not given is absent, which is how a button knows the console it would
 * open is not live yet.
 */
let cached: ConsoleLinks | null = null;
let inflight: Promise<ConsoleLinks> | null = null;

export function useConsoleLinks(): ConsoleLinks | null {
  const [links, setLinks] = useState<ConsoleLinks | null>(cached);
  useEffect(() => {
    if (cached) return;
    let live = true;
    inflight ??= fetch("/api/links", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ConsoleLinks | null) => (cached = d && typeof d.workloads === "object" && d.workloads ? d : { workloads: {} }))
      .catch(() => (cached = { workloads: {} }));
    void inflight.then((d) => live && setLinks(d));
    return () => {
      live = false;
    };
  }, []);
  return links;
}
