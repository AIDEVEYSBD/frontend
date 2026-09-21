"use client";

import { useEffect, useState } from "react";
import { Button, Status } from "./ui";

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

export function Appearance() {
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
      const d = await r.json();
      if (!r.ok) throw new Error(String(d.error ?? r.status));
      setAccent(Boolean(d.accent));
      applyAccent(Boolean(d.accent));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div className="flex items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
        <span className="text-[12px] font-semibold">Console appearance</span>
        <span className="text-[11px] text-faint">one choice for every browser and every person</span>
        <span className="grow" />
        {accent !== null && <Status tone="neutral" dot={false}>{accent ? "subject colours" : "monochrome"}</Status>}
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="max-w-[60ch] text-[12px] leading-[1.55] text-faint">
          Card headers can carry a colour for their subject: spend green, approvals amber, live activity blue, controls red, knowledge violet, identity teal, traces indigo. Or the console can stay on its monochrome base.
        </span>
        <span className="grow" />
        <Button size="sm" variant="solid" tone={accent ? "ink" : "neutral"} permission="configure" loading={busy && accent === false} disabled={accent === null || accent === true} onClick={() => choose(true)}>Subject colours</Button>
        <Button size="sm" variant="solid" tone={accent === false ? "ink" : "neutral"} permission="configure" loading={busy && accent === true} disabled={accent === null || accent === false} onClick={() => choose(false)}>Monochrome</Button>
      </div>
      {error && <p className="border-t border-line px-4 py-2 text-[11.5px] text-err">{error}</p>}
    </section>
  );
}
