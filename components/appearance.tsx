"use client";

import { useEffect, useState } from "react";
import { Button, Status } from "./ui";
import { QuietNote } from "./overlays";
import { QUIET } from "@/lib/quiet";

/**
 * The console's appearance, chosen once for everyone.
 *
 * Two looks: subject colours on the card headers, or the monochrome base.
 * The choice is a server-side setting, so it holds across browsers and
 * people; each browser also keeps a mirror so the first paint is right.
 */

export const ACCENT_KEY = "af.ui.accent";

export function applyAccent(on: boolean) {
  document.documentElement.dataset.accent = on ? "on" : "off";
  try {
    localStorage.setItem(ACCENT_KEY, on ? "on" : "off");
  } catch {
    /* fine */
  }
}

/** The body of Configuration's Appearance panel (components/configuration.tsx). `bare`: the console has nothing behind it, so nothing keeps the choice. */
export function Appearance({ bare = false }: { bare?: boolean | null }) {
  const [accent, setAccent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/ui", { cache: "no-store" }).then((r) => r.json()).then((d) => setAccent(Boolean(d.accent))).catch(() => setAccent(true));
  }, []);

  const choose = async (on: boolean) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/ui", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accent: on }) });
      // A page in place of an answer is no message: the status alone is the reason.
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(d.error ?? r.status));
      setAccent(Boolean(d.accent));
      applyAccent(Boolean(d.accent));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // The one calm line of a panel whose record was not read (PanelNote in components/providers.tsx, kept out of this file because the chrome imports it).
  if (bare === true) {
    return (
      <div className="px-4 py-3">
        <QuietNote inline />
      </div>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <span className="text-[11.5px] text-faint">In use</span>
        {accent !== null && <Status tone="neutral" dot={false}>{accent ? "subject colours" : "monochrome"}</Status>}
        <span className="grow" />
        <Button size="sm" variant="solid" tone={accent ? "ink" : "neutral"} permission="configure" loading={busy && accent === false} disabled={accent === null || accent === true} onClick={() => choose(true)}>Subject colours</Button>
        <Button size="sm" variant="solid" tone={accent === false ? "ink" : "neutral"} permission="configure" loading={busy && accent === true} disabled={accent === null || accent === false} onClick={() => choose(false)}>Monochrome</Button>
      </div>
      {error && (QUIET ? <p className="border-t border-line px-4 py-2"><QuietNote inline /></p> : <p className="border-t border-line px-4 py-2 text-[11.5px] text-err">{error}</p>)}
    </>
  );
}
