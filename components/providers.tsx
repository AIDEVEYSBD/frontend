"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Tag } from "./ui";
import { Banner } from "./overlays";
import { Icon } from "./builder/icons";
import { Pick } from "./select";
import { Text } from "./builder/controls";
import { Checkbox } from "./forms";
import { FOUNDRY_ID, KINDS, kindOf, type Provider, type ProviderKind } from "@/lib/providers";

/**
 * The endpoint router: every place this deployment can send a model call.
 *
 * A provider is an endpoint plus a credential name plus whether it is
 * local. Adding one and discovering its models puts those models on the
 * offered list beside the Foundry deployments, and the runtime then routes
 * each call to the provider its model names. Credentials never appear here:
 * a provider records the name of a vault key, and only the runtime reads
 * the value, at the moment of the call.
 */

interface Offered { id: string; label: string; class?: "small" | "medium" | "large"; price_in?: number; price_out?: number; provider?: string; served_as?: string }
interface Config { models: Offered[]; default_model: string; class_defaults?: Record<string, string>; providers: Provider[]; node_routes?: Record<string, string> }
interface Found { id: string; label: string; meta?: string }

/** Tell the other settings cards the configuration changed under them. */
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

export function Providers() {
  const [config, setConfig] = useState<Config | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);
  const [discoverFor, setDiscoverFor] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(String(d.error)) : setConfig(d)))
      .catch((e) => setError(String(e)));
    fetch("/api/vault")
      .then((r) => r.json())
      .then((d) => setKeys(((d.keys ?? []) as { name: string }[]).map((k) => k.name)))
      .catch(() => setKeys([]));
  }, []);
  useEffect(refresh, [refresh]);
  useConfigChanges(refresh);

  const write = useCallback(async (patch: Partial<Config>) => {
    setError("");
    const res = await fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) {
      setError(String(d.error ?? `HTTP ${res.status}`));
      return false;
    }
    setConfig(d);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
    announceConfig();
    return true;
  }, []);

  const modelsOf = (id: string) => (config?.models ?? []).filter((m) => (m.provider ?? FOUNDRY_ID) === id);

  const remove = async (p: Provider) => {
    if (!config) return;
    const keep = config.models.filter((m) => (m.provider ?? FOUNDRY_ID) !== p.id);
    if (!keep.length) {
      setError("Removing this provider would leave no offered model. Offer a model from another provider first.");
      return;
    }
    await write({ providers: config.providers.filter((x) => x.id !== p.id), models: keep });
  };

  const setHourly = async (p: Provider, v: string) => {
    if (!config) return;
    await write({ providers: config.providers.map((x) => (x.id === p.id ? { ...x, hourly_usd: v === "" ? undefined : Number(v) } : x)) });
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <Icon name="server" size={15} className="text-dim" />
        <h2 className="text-[14px] font-semibold">Providers</h2>
        <span className="tnum font-mono text-[11px] text-faint">{config ? `${config.providers.length} endpoint${config.providers.length === 1 ? "" : "s"}` : "…"}</span>
        <span className="grow" />
        <span className={`text-[11px] transition-opacity ${saved ? "text-ok opacity-100" : "opacity-0"}`}>saved</span>
        {!adding && (
          <Button size="sm" variant="solid" permission="configure" onClick={() => setAdding(true)}>
            Add provider
          </Button>
        )}
      </header>

      <div className="border-b border-line px-4 py-3">
        <p className="text-[11.5px] leading-[1.55] text-faint">
          Where model calls can go. The Foundry gateway comes from the environment; add a Vertex or Bedrock endpoint, an OpenAI-compatible service, or a
          vLLM, Ollama or LM Studio server on your own hardware. Discover what each serves and offer the models you want; the runtime routes every call to the
          provider its model names, with that provider&rsquo;s credential from the vault. Local providers are priced by the hardware hour, not per token, and
          the FinOps page uses that rate.
        </p>
      </div>

      {error && (
        <div className="border-b border-line px-4 py-2.5">
          <Banner tone="err" title="Providers">
            {error}
          </Banner>
        </div>
      )}

      {adding && config && (
        <AddProvider
          keys={keys}
          existing={config.providers.map((p) => p.id)}
          onCancel={() => setAdding(false)}
          onSave={async (p, models) => {
            const ok = await write({
              providers: [...config.providers.filter((x) => x.id !== FOUNDRY_ID), p],
              models: [...config.models, ...models.filter((m) => !config.models.some((x) => x.id === m.id)).map((m) => ({ id: m.id, label: m.label, provider: p.id }))],
            });
            if (ok) setAdding(false);
          }}
        />
      )}

      <div className="flex flex-col">
        {(config?.providers ?? []).map((p) => {
          const models = modelsOf(p.id);
          const builtin = p.id === FOUNDRY_ID;
          return (
            <div key={p.id} className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-medium text-fg">{p.label}</span>
                <Tag tone={p.local ? "ok" : "neutral"}>{p.local ? "local" : "cloud"}</Tag>
                <span className="text-[10.5px] text-faint">{kindOf(p.kind).label}</span>
                {builtin && <span className="text-[10.5px] text-ghost">· from the environment</span>}
                <span className="grow" />
                <span className="tnum text-[11px] text-dim">{models.length} model{models.length === 1 ? "" : "s"} offered</span>
                <Button size="sm" variant="quiet" permission="configure" onClick={() => setDiscoverFor(discoverFor === p.id ? null : p.id)}>
                  {discoverFor === p.id ? "Close" : "Discover models"}
                </Button>
                {!builtin && (
                  <Button size="sm" variant="solid" tone="err" permission="configure" onClick={() => remove(p)}>
                    Remove
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-faint">
                <span className="truncate font-mono" title={p.endpoint}>{p.endpoint || "FOUNDRY_ENDPOINT"}</span>
                <span>key: <code className="font-mono">{p.key_ref || "none"}</code></span>
                {p.local && (
                  <label className="flex items-center gap-1">
                    hardware $/hour
                    <input
                      type="number"
                      min={0}
                      step="0.05"
                      defaultValue={p.hourly_usd ?? ""}
                      placeholder="?"
                      onBlur={(e) => setHourly(p, e.target.value)}
                      className="focusable h-6 w-16 rounded-md border border-line-strong bg-field px-1.5 font-mono text-[10.5px] text-fg placeholder:text-ghost"
                    />
                  </label>
                )}
              </div>
              {models.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {models.map((m) => (
                    <span key={m.id} className="rounded-sm border border-line px-1.5 py-px font-mono text-[9.5px] text-dim" title={m.label}>
                      {m.id}
                      {m.class && <span className="ml-1 text-ghost">{m.class}</span>}
                    </span>
                  ))}
                </div>
              )}
              {discoverFor === p.id && (
                <Discover
                  provider={p}
                  already={new Set(models.map((m) => m.id))}
                  onOffer={async (rows) => {
                    const ok = await write({ models: [...config!.models, ...rows.map((m) => ({ id: m.id, label: m.label, ...(builtin ? {} : { provider: p.id }) }))] });
                    if (ok) setDiscoverFor(null);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Discover({ provider, already, onOffer }: { provider: Pick<Provider, "kind" | "endpoint" | "key_ref" | "models_url">; already: Set<string>; onOffer: (rows: Found[]) => Promise<void> }) {
  const [rows, setRows] = useState<Found[] | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const busy = rows === null && !error;

  useEffect(() => {
    let live = true;
    fetch("/api/providers/discover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(provider) })
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        if (d.error) setError(String(d.error));
        setRows(d.models ?? []);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [provider]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => !q || r.id.toLowerCase().includes(q) || r.label.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-canvas p-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-dim">{busy ? "Asking the endpoint…" : rows ? `${rows.length} served` : ""}</span>
        <span className="grow" />
        <div className="w-56">
          <Text value={query} onChange={setQuery} placeholder="Filter" aria-label="Filter discovered models" />
        </div>
        <Button size="sm" variant="solid" permission="configure" disabled={!picked.size} onClick={() => onOffer(shown.filter((r) => picked.has(r.id)))}>
          Offer {picked.size || ""} selected
        </Button>
      </div>
      {error && <Banner tone="warn" title="Discovery failed">{error}</Banner>}
      <div className="max-h-[260px] overflow-y-auto">
        {shown.slice(0, 200).map((r) => {
          const on = already.has(r.id);
          return (
            <label key={r.id} className={`flex items-center gap-2.5 border-b border-line py-1.5 last:border-b-0 ${on ? "opacity-60" : ""}`}>
              <Checkbox
                checked={on || picked.has(r.id)}
                disabled={on}
                onChange={() =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (n.has(r.id)) n.delete(r.id);
                    else n.add(r.id);
                    return n;
                  })
                }
                aria-label={`Offer ${r.id}`}
              />
              <span className="flex min-w-0 grow flex-col">
                <span className="truncate font-mono text-[11px] text-fg">{r.id}</span>
                {r.label !== r.id && <span className="truncate text-[10px] text-faint">{r.label}</span>}
              </span>
              {r.meta && <span className="shrink-0 text-[10px] text-ghost">{r.meta}</span>}
              {on && <span className="shrink-0 text-[9.5px] text-ghost">offered</span>}
            </label>
          );
        })}
        {rows && !shown.length && !busy && <p className="py-3 text-center text-[11px] text-faint">Nothing served, or nothing matches.</p>}
      </div>
    </div>
  );
}

function AddProvider({ keys, existing, onCancel, onSave }: { keys: string[]; existing: string[]; onCancel: () => void; onSave: (p: Provider, models: Found[]) => Promise<void> }) {
  const [kind, setKind] = useState<ProviderKind>("vllm");
  const [label, setLabel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [keyRef, setKeyRef] = useState("");
  const [local, setLocal] = useState(true);
  const [hourly, setHourly] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  const known = kindOf(kind);
  const id = (label || known.label).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const taken = existing.includes(id);

  const choose = (k: ProviderKind) => {
    setKind(k);
    setLocal(kindOf(k).local);
    setFound(null);
    setPicked(new Set());
  };

  const test = async () => {
    setTesting(true);
    setTestError("");
    try {
      const res = await fetch("/api/providers/discover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, endpoint, key_ref: keyRef }) });
      const d = await res.json();
      if (d.error) setTestError(String(d.error));
      setFound(d.models ?? []);
      setPicked(new Set((d.models ?? []).slice(0, 5).map((m: Found) => m.id)));
    } catch (e) {
      setTestError(String(e));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(
        { id, label: label || known.label, kind, endpoint: endpoint.trim(), ...(keyRef ? { key_ref: keyRef } : {}), local, ...(local && hourly !== "" ? { hourly_usd: Number(hourly) } : {}) },
        (found ?? []).filter((m) => picked.has(m.id)),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-b border-line bg-canvas px-4 py-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-[11px] text-faint">
          Kind
          <Pick value={kind} onChange={choose} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />
          <span className="text-[10px] text-ghost">{known.hint}</span>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-faint">
          Name
          <Text value={label} onChange={setLabel} placeholder={known.label} aria-label="Provider name" />
          <span className="text-[10px] text-ghost">{taken ? <span className="text-err">a provider with this name exists</span> : `id: ${id || "…"}`}</span>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-faint md:col-span-2">
          Chat-completions endpoint
          <Text value={endpoint} onChange={setEndpoint} placeholder={known.example} mono aria-label="Endpoint" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-faint">
          Credential (vault key)
          <Pick value={keyRef} onChange={setKeyRef} options={[{ value: "", label: local ? "none — open local endpoint" : "none" }, ...keys.map((k) => ({ value: k, label: k }))]} />
          <span className="text-[10px] text-ghost">Add the key under Keys first; only its name is stored here.</span>
        </label>
        <div className="flex flex-col gap-1 text-[11px] text-faint">
          Pricing
          <label className="flex h-7 items-center gap-2 text-[11.5px] text-dim">
            <Checkbox checked={local} onChange={() => setLocal(!local)} aria-label="Served locally" />
            Local hardware — $0 per token
          </label>
          {local && (
            <label className="flex items-center gap-2 text-[11px] text-dim">
              fully loaded $/hour
              <input type="number" min={0} step="0.05" value={hourly} onChange={(e) => setHourly(e.target.value)} placeholder="e.g. 2.50" className="focusable h-7 w-24 rounded-md border border-line-strong bg-field px-1.5 font-mono text-[11px] text-fg placeholder:text-ghost" />
            </label>
          )}
          {!local && <span className="text-[10px] text-ghost">Record $/M tokens beside each offered model in the Models card.</span>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="quiet" loading={testing} disabled={!endpoint.trim()} onClick={test}>
          Test and discover models
        </Button>
        {found && !testError && <span className="text-[11px] text-ok">{found.length} model{found.length === 1 ? "" : "s"} served</span>}
        {testError && <span className="text-[11px] text-err">{testError}</span>}
        <span className="grow" />
        <Button size="sm" variant="quiet" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="solid" permission="configure" loading={saving} disabled={!endpoint.trim() || !id || taken} onClick={save}>
          Save provider{picked.size ? ` and offer ${picked.size}` : ""}
        </Button>
      </div>

      {found && found.length > 0 && (
        <div className="max-h-[220px] overflow-y-auto rounded-md border border-line bg-surface px-3">
          {found.slice(0, 200).map((m) => (
            <label key={m.id} className="flex items-center gap-2.5 border-b border-line py-1.5 last:border-b-0">
              <Checkbox
                checked={picked.has(m.id)}
                onChange={() =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (n.has(m.id)) n.delete(m.id);
                    else n.add(m.id);
                    return n;
                  })
                }
                aria-label={`Offer ${m.id}`}
              />
              <span className="truncate font-mono text-[11px] text-fg">{m.id}</span>
              {m.meta && <span className="ml-auto shrink-0 text-[10px] text-ghost">{m.meta}</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
