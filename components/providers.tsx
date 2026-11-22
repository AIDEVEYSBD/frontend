"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { QuietNote } from "./overlays";
import { QUIET } from "@/lib/quiet";
import { Pick } from "./select";
import { kindOf, type Provider } from "@/lib/providers";
import { DATA_CLASSES, type DataClass } from "@/lib/api/pending";

/**
 * The endpoints this deployment can send a model call to.
 *
 * They are set when the platform is deployed, and the service lists them in
 * `GET /api/config`. This panel shows each one with its kind, its address
 * and the offered models that are called on it. Nothing here adds, changes
 * or removes an endpoint, and no credential appears: the service holds it.
 * A deployment with no endpoint says so.
 */

interface Offered { id: string; label: string; class?: "small" | "medium" | "large"; provider?: string; max_data_class?: DataClass }
interface Config { models: Offered[]; providers: Provider[] }

/* ═══════════════════ permitted data class (5.3) ═══════════════════
   The highest class of data a model may be sent. The screen is ahead of the
   platform: `POST /api/config` keeps a `max_data_class` on an offered model,
   but nothing reads it when a call is made. Until something does, the control
   is shown disabled with whatever value the service answers, and never
   writes. The day it is enforced, DATA_CLASS_ENFORCED turns true and the
   control saves through the same write as every other field of a model. */
export const DATA_CLASS_ENFORCED = false;

export function PermittedClass({ value, onChange, label }: { value?: string; onChange?: (v: DataClass | "") => void; label: string }) {
  const options = [{ value: "", label: "not set" }, ...DATA_CLASSES.map((c) => ({ value: c as string, label: c }))];
  if (value && !options.some((o) => o.value === value)) options.push({ value, label: value });
  return (
    <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
      permitted data class
      <span className="block w-[132px]">
        <Pick value={value ?? ""} onChange={(v) => onChange?.(v as DataClass | "")} options={options} disabled={!DATA_CLASS_ENFORCED || !onChange} aria-label={label} />
      </span>
    </span>
  );
}

/** One line under the rows that show the field: what it is, and that nothing enforces it yet. */
export function PermittedClassNote() {
  if (DATA_CLASS_ENFORCED) return <span className="text-[11.5px] leading-[1.5] text-faint">Permitted data class is the highest class of data a model may be sent.</span>;
  return (
    <span className="text-[11.5px] leading-[1.5] text-faint" data-pending="/api/config">
      Permitted data class is the highest class of data a model may be sent. Nothing enforces it on this deployment yet, so it cannot be set here.
    </span>
  );
}

/** One calm line for a Configuration panel whose record was not read (a quiet console, lib/quiet.ts). */
export function PanelNote() {
  return (
    <div className="px-4 py-3">
      <QuietNote inline />
    </div>
  );
}

/** A read or a write that failed inside a Configuration panel: its plain reason, or the one calm line in a quiet console. */
export function PanelFailure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <p className="border-b border-line px-4 py-2.5 text-[11.5px] leading-[1.5] whitespace-pre-wrap text-err last:border-b-0">
      {QUIET ? (
        <QuietNote inline />
      ) : (
        <>
          <span className="font-medium">{title}.</span> {children}
        </>
      )}
    </p>
  );
}

/** Tell the other configuration panels the configuration changed under them. */
const CONFIG_EVENT = "af:config";
export function announceConfig() {
  window.dispatchEvent(new CustomEvent(CONFIG_EVENT));
}
export function useConfigChanges(refresh: () => void) {
  useEffect(() => {
    window.addEventListener(CONFIG_EVENT, refresh);
    return () => window.removeEventListener(CONFIG_EVENT, refresh);
  }, [refresh]);
}

/**
 * The body of Configuration's Providers panel (components/configuration.tsx).
 *
 * `bare` is what the page knows about the console itself: true when it has
 * nothing behind it, null while that is still being read. A quiet console
 * with nothing behind it shows the one calm line, never "no endpoint is
 * connected" read from nowhere. `onQuiet` tells the page, once the read has
 * settled, whether that line is all the panel shows, so a tab of such panels
 * can say it once.
 */
export function Providers({ bare = false, onQuiet }: { bare?: boolean | null; onQuiet?: (quiet: boolean) => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    fetch("/api/config")
      .then(async (r) => {
        // A page (a proxy's 502, Next's own 404) is no answer and no message: the status alone is the reason.
        const d = await r.json().catch(() => null);
        if (!d) throw new Error(`the server answered ${r.status}`);
        return d;
      })
      .then((d) => {
        if (d.error) return setError(String(d.error));
        setError("");
        setConfig({ models: Array.isArray(d.models) ? d.models : [], providers: Array.isArray(d.providers) ? d.providers : [] });
      })
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(refresh, [refresh]);
  // The Models panel changes which models are offered; the counts here follow it.
  useConfigChanges(refresh);

  const none = (config?.providers ?? []).length === 0;
  // Quiet: nothing was read from anywhere (the console is bare, or the read failed), so the panel does not say there are none.
  const unread = none && (bare === true || (QUIET && Boolean(error) && !config));
  const settled = config !== null || Boolean(error);
  useEffect(() => {
    if (settled) onQuiet?.(unread);
  }, [settled, unread, onQuiet]);

  if (unread) return <PanelNote />;
  // Not known yet whether anything is behind the console: no "none connected" in the meantime.
  if (!config || (none && bare === null)) {
    return error && config === null ? <PanelFailure title="The providers could not be read">{error}</PanelFailure> : <p className="px-4 py-3 text-[11.5px] text-faint">Reading the configuration&hellip;</p>;
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2 last:border-b-0">
        {!none && <span className="tnum text-[11px] text-faint">{`${config.providers.length} endpoint${config.providers.length === 1 ? "" : "s"}`}</span>}
        <span className="min-w-0 max-w-[92ch] text-[12px] leading-[1.55] text-dim">
          {none && "No model endpoint is connected, so this deployment has nowhere to send a model call yet. "}
          Endpoints are set when the platform is deployed.
        </span>
      </div>

      {error && <PanelFailure title="The providers could not be read again">{error}</PanelFailure>}

      {config.providers.map((p) => {
        const models = config.models.filter((m) => m.provider === p.id);
        return (
          <div key={p.id} className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-medium text-fg">{p.label}</span>
              <span className="text-[10.5px] text-faint">{kindOf(p.kind).label}</span>
              <span className="grow" />
              <span className="tnum text-[11px] text-dim">{models.length} model{models.length === 1 ? "" : "s"} offered</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-faint">
              <span className="truncate font-mono" title={p.endpoint}>{p.endpoint || "address not stated"}</span>
            </div>
            {models.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {models.map((m) => (
                  <span key={m.id} className="rounded-sm border border-line px-1.5 py-px font-mono text-[9.5px] text-dim" title={m.label}>
                    {m.id}
                    {m.class && <span className="ml-1 text-ghost">{m.class}</span>}
                    {m.max_data_class && <span className="ml-1 text-ghost">up to {m.max_data_class}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
