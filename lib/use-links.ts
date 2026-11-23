"use client";

import { useEffect, useState } from "react";
import { errorText } from "@/lib/api/client";
import type { ConsoleLinks } from "@/lib/service-answers";

/**
 * The addresses of the consoles this one hands off to (`GET /api/links`),
 * read once and shared. `links` is null until the answer is in; an address a
 * deployment has not given is absent, which is how a button knows the console
 * it would open is not live yet. A read that failed is never taken as "no
 * address given": `error` carries its reason, and only an answer is cached,
 * so the next page that asks reads again.
 */
let cached: ConsoleLinks | null = null;
let inflight: Promise<ConsoleLinks> | null = null;

async function readLinks(): Promise<ConsoleLinks> {
  const r = await fetch("/api/links", { cache: "no-store" });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(errorText(d, r, "GET", "/api/links"));
  if (!d || typeof d.workloads !== "object" || !d.workloads) throw new Error("GET /api/links answered with no workloads");
  return d as ConsoleLinks;
}

export function useConsoleLinks(): { links: ConsoleLinks | null; error: string } {
  const [links, setLinks] = useState<ConsoleLinks | null>(cached);
  const [error, setError] = useState("");
  useEffect(() => {
    if (cached) return;
    let live = true;
    inflight ??= readLinks()
      .then((d) => (cached = d))
      .finally(() => {
        inflight = null;
      });
    inflight.then(
      (d) => live && setLinks(d),
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, []);
  return { links, error };
}
