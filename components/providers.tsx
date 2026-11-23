"use client";
import { Failure } from "./pending";
import { errorText, notBuiltDoorOf } from "@/lib/api/client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Status } from "./ui";
import { kindOf, type Provider } from "@/lib/providers";
import type { DataClass } from "@/lib/api/pending";

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

/** A read or a write that failed inside a Configuration panel: its plain reason with the status and the address, or the not-built note for a 501. */
export function PanelFailure({ title, children }: { title: string; children: ReactNode }) {
  if (typeof children === "string" && notBuiltDoorOf(children))
    return (
      <p className="border-b border-line px-4 py-2.5 last:border-b-0">
        <Failure inline message={children} />
      </p>
    );
  return (
    <p className="border-b border-line px-4 py-2.5 text-[11.5px] leading-[1.5] whitespace-pre-wrap text-err last:border-b-0">
      <span className="font-medium">{title}.</span> {children}
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
 */
export function Providers() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    fetch("/api/config")
      .then(async (r) => {
        // A page (a proxy's 502, Next's own 404) is no answer and no message: the status alone is the reason.
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || d.error) throw new Error(errorText(d, r, "GET", "/api/config"));
        return d;
      })
      .then((d) => {
        setError("");
        setConfig({ models: Array.isArray(d.models) ? d.models : [], providers: Array.isArray(d.providers) ? d.providers : [] });
      })
      .catch((e) => setError((e as Error).message || String(e)));
  }, []);
  useEffect(refresh, [refresh]);
  // The Models panel changes which models are offered; the counts here follow it.
  useConfigChanges(refresh);

  const none = (config?.providers ?? []).length === 0;

  if (!config) {
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
              {p.connected === true && <Status tone="ok">Connected</Status>}
              {p.connected === false && <Status tone="err">Not connected</Status>}
              <span className="grow" />
              <span className="tnum text-[11px] text-dim">{models.length} model{models.length === 1 ? "" : "s"} offered</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-faint">
              <span className="truncate font-mono" title={p.endpoint}>{p.endpoint || "address not stated"}</span>
              {p.checked_at && <span>checked {new Date(p.checked_at).toLocaleTimeString("en-GB")}</span>}
              {p.listed_from && <span>models listed from {p.listed_from === "MODEL_NAMES" ? "the MODEL_NAMES setting, not the endpoint's own list" : p.listed_from}</span>}
            </div>
            {p.connected === false && (
              <p className="text-[11.5px] leading-[1.5] text-err" role="alert">
                The platform could not reach this endpoint{p.error ? `: ${p.error}` : ", and gave no reason"}. A model offered on it cannot be called.
              </p>
            )}
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
