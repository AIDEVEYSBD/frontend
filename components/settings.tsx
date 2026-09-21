"use client";

import { Appearance } from "./appearance";
import { Providers, useConfigChanges } from "./providers";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Status } from "./ui";
import { Checkbox, Input, Segmented } from "./forms";
import { Banner } from "./overlays";
import { Skeleton } from "./loaders";
import { Icon } from "./builder/icons";
import { Pick } from "./select";
import { Cross, Row, Text } from "./builder/controls";

/**
 * The factory's configuration: which models it offers, and the keys its
 * connectors read.
 *
 * Models: the Foundry resource's deployments, and a dropdown with
 * hundreds of entries is a way of choosing nothing. Whoever runs this factory
 * picks the short list here; every model picker in the builder shows exactly
 * that list and nothing else.
 *
 * Keys: named credentials, referenced from specs as ${secret:name}. Values
 * arrive here and leave masked — the only consumer of a live key is the
 * runtime, at the moment a tool is called.
 */

interface CatalogueModel {
  id: string;
  label: string;
  context: number;
  price: number;
  price_out?: number;
  /** Provider id for models offered from an added provider; absent for Foundry deployments. */
  provider?: string;
}

type ModelClass = "small" | "medium" | "large";
const MODEL_CLASSES: ModelClass[] = ["small", "medium", "large"];

interface Config {
  models: { id: string; label: string; class?: ModelClass; price_in?: number; price_out?: number; provider?: string }[];
  default_model: string;
  class_defaults?: Partial<Record<ModelClass, string>>;
  providers?: { id: string; label: string; local?: boolean }[];
}

interface VaultKey {
  name: string;
  label: string;
  value: string;
  used_by: string[];
  set: boolean;
  last_used: string;
}

export function Settings() {
  return (
    <div className="min-h-full" data-hue="green">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-8 px-5 py-7">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Configuration</h1>
          <p className="max-w-[620px] text-[13.5px] leading-relaxed text-dim">
            Manage the providers this factory can reach, the approved models available to workflows, and the
            protected credentials that connectors resolve at runtime.
          </p>
        </header>

        <Appearance />

        <Providers />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Models />
          <Keys />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ Models ═══════════════════ */

function Models() {
  const [catalogue, setCatalogue] = useState<CatalogueModel[] | null>(null);
  const [catalogueError, setCatalogueError] = useState("");
  const [config, setConfig] = useState<Config | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("Name");
  const [savedTick, setSavedTick] = useState(false);
  const [lastGuard, setLastGuard] = useState(false);
  const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const queued = useRef<Config | null>(null);

  const reloadConfig = useCallback(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig({ models: [], default_model: "" }));
  }, []);
  useConfigChanges(reloadConfig);
  useEffect(() => {
    reloadConfig();
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setCatalogueError(String(d.error));
        setCatalogue(d.models ?? []);
      })
      .catch((e) => {
        setCatalogueError(String(e));
        setCatalogue([]);
      });
  }, [reloadConfig]);

  const chosen = useMemo(() => new Set((config?.models ?? []).map((m) => m.id)), [config]);
  const providerLabel = useCallback((id?: string) => (config?.providers ?? []).find((p) => p.id === id), [config]);

  const shown = useMemo(() => {
    if (!catalogue) return [];
    // Models offered from added providers are not Foundry deployments; they
    // join the list from the configuration so their tier and price are editable here.
    const ids = new Set(catalogue.map((m) => m.id));
    const extra: CatalogueModel[] = (config?.models ?? [])
      .filter((m) => !ids.has(m.id))
      .map((m) => ({ id: m.id, label: m.label, context: 0, price: 0, provider: m.provider ?? (m.id === "scripted" ? undefined : "other") }));
    const all = [...catalogue, ...extra];
    const q = query.trim().toLowerCase();
    const rows = q
      ? all.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
      : all;
    const by: Record<string, (a: CatalogueModel, b: CatalogueModel) => number> = {
      Name: (a, b) => a.label.localeCompare(b.label),
      Price: (a, b) => (a.price || 0) - (b.price || 0),
      Context: (a, b) => b.context - a.context,
    };
    const cmp = by[sort] ?? by.Name;
    // Selected first, then the chosen order — the working set stays in view.
    return [...rows].sort((a, b) => {
      const sa = chosen.has(a.id) ? 0 : 1;
      const sb = chosen.has(b.id) ? 0 : 1;
      return sa - sb || cmp(a, b) || a.label.localeCompare(b.label);
    });
  }, [catalogue, config, query, chosen, sort]);

  // Writes go out one at a time and a burst of ticks collapses to the latest
  // config — the UI is optimistic, the wire is serialized, last one wins.
  const push = useCallback(async (first: Config) => {
    if (inFlight.current) {
      queued.current = first;
      return;
    }
    inFlight.current = true;
    let next: Config | null = first;
    try {
      // Drain: whatever was queued while a write was in flight goes next, and only the latest.
      while (next) {
        const res = await fetch("/api/config", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
        });
        if (res.ok) {
          setSavedTick(true);
          setTimeout(() => setSavedTick(false), 1200);
        }
        next = queued.current;
        queued.current = null;
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  const save = useCallback(
    (next: Config) => {
      setConfig(next);
      void push(next);
    },
    [push],
  );

  const toggle = (m: CatalogueModel) => {
    if (!config) return;
    const has = chosen.has(m.id);
    if (has && config.models.length === 1) {
      // Say why nothing happened instead of silently ignoring the click.
      setLastGuard(true);
      if (guardTimer.current) clearTimeout(guardTimer.current);
      guardTimer.current = setTimeout(() => setLastGuard(false), 3000);
      return;
    }
    const models = has
      ? config.models.filter((x) => x.id !== m.id)
      : [...config.models, { id: m.id, label: m.label, ...(m.provider && m.provider !== "other" ? { provider: m.provider } : {}) }];
    save({
      models,
      default_model: models.some((x) => x.id === config.default_model)
        ? config.default_model
        : (models[0]?.id ?? ""),
    });
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <Icon name="chip" size={15} className="text-dim" />
        <h2 className="text-[14px] font-semibold">Models</h2>
        <span className="tnum font-mono text-[11px] text-faint">
          {config ? `${config.models.length} offered` : "…"}
        </span>
        <span className="grow" />
        <span className={`text-[11px] transition-opacity ${savedTick ? "text-ok opacity-100" : "opacity-0"}`}>
          saved
        </span>
      </header>

      <div className="flex flex-col gap-2.5 border-b border-line px-4 py-3">
        <p className="text-[11.5px] leading-[1.55] text-faint">
          The deployments on the Foundry resource. Tick
          what this factory offers; every model dropdown in the builder shows exactly this list, and
          a spec names a deployment, never a provider. Record the price per million tokens beside
          each offered model: it is what cost figures and model comparisons are computed from.
        </p>
        <Text value={query} onChange={setQuery} placeholder="Search the catalogue" aria-label="Search the catalogue" />
        {/* Segmented is uncontrolled by design — the wrapper reads the choice
            off the bubbling click so this page can hold the sort itself. */}
        <div
          className="flex items-center gap-2"
          onClick={(e) => {
            const b = (e.target as HTMLElement).closest("button");
            if (b?.textContent) setSort(b.textContent);
          }}
        >
          <span className="text-[11px] text-faint">Sort</span>
          <Segmented options={["Name", "Price", "Context"]} defaultValue="Name" />
        </div>
        {catalogueError && (
          <Banner tone="warn" title="The catalogue could not be read">
            {catalogueError} — the selected list still works; only browsing is unavailable.
          </Banner>
        )}
      </div>

      {lastGuard && (
        <div className="border-b border-line px-4 py-2.5">
          <Banner tone="warn" title="At least one model must stay offered." />
        </div>
      )}

      <div className="max-h-[460px] min-h-[200px] overflow-y-auto">
        {catalogue === null && (
          <div className="px-4 py-4" role="status" aria-label="Loading the catalogue">
            <Skeleton lines={4} />
          </div>
        )}
        {shown.slice(0, 80).map((m) => {
          const on = chosen.has(m.id);
          const isDefault = config?.default_model === m.id;
          return (
            <div
              key={m.id}
              className={`flex flex-col gap-1.5 border-b border-line px-4 py-2 last:border-b-0 ${
                on ? "" : "opacity-75"
              }`}
            >
              {/* Identity and price on one line; long catalogue names truncate
                  rather than push anything past the card edge. */}
              <div className="flex min-w-0 items-center gap-3">
                <Checkbox checked={on} onChange={() => toggle(m)} aria-label={`Offer ${m.label}`} />
                <div className="flex min-w-0 grow flex-col">
                  <span className="flex items-center gap-1.5 truncate text-[12.5px] font-medium text-fg" title={m.label}>
                    {m.label}
                    {m.provider && (
                      <span className={`shrink-0 rounded-[3px] border px-1 py-px font-mono text-[9px] font-semibold ${providerLabel(m.provider)?.local ? "border-ok/40 text-ok" : "border-line-strong text-dim"}`} title="Served by this provider">
                        {providerLabel(m.provider)?.label ?? m.provider}
                      </span>
                    )}
                  </span>
                  <span className="truncate font-mono text-[10.5px] text-faint" title={m.id}>{m.id}</span>
                </div>
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                  {m.price > 0 && (
                    <span className="tnum font-mono text-[10px] text-ghost">
                      {(m.price_out ?? 0) > 0
                        ? `$${m.price.toFixed(2)} in · $${(m.price_out ?? 0).toFixed(2)} out /M`
                        : `$${m.price.toFixed(2)}/M in`}
                    </span>
                  )}
                  {m.context > 0 && (
                    <span className="tnum font-mono text-[10px] text-ghost">{Math.round(m.context / 1000)}k ctx</span>
                  )}
                </span>
              </div>
              {/* The controls an offered model carries, on their own line so
                  a narrow column never clips the tier picker. */}
              {on && (
                <div className="flex flex-wrap items-center gap-2 pl-7">
                  <div className="w-32">
                    <Pick
                      value={config?.models.find((x) => x.id === m.id)?.class ?? ""}
                      onChange={(v) =>
                        config &&
                        save({
                          ...config,
                          models: config.models.map((x) =>
                            x.id === m.id ? { ...x, ...(v ? { class: v as ModelClass } : { class: undefined }) } : x,
                          ),
                        })
                      }
                      options={[{ value: "", label: "no tier" }, ...MODEL_CLASSES.map((c) => ({ value: c, label: c }))]}
                    />
                  </div>
                  {config?.models.find((x) => x.id === m.id)?.class &&
                    (config.class_defaults?.[config.models.find((x) => x.id === m.id)!.class!] === m.id ? (
                      <span className="shrink-0 rounded-[3px] border border-line-strong px-1 py-px font-mono text-[9px] font-semibold text-dim" title="The model the router picks for this tier">
                        TIER DEFAULT
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="quiet"
                        className="shrink-0"
                        onClick={() =>
                          config &&
                          save({
                            ...config,
                            class_defaults: { ...(config.class_defaults ?? {}), [config.models.find((x) => x.id === m.id)!.class!]: m.id },
                          })
                        }
                      >
                        tier default
                      </Button>
                    ))}
                  {/* Cost per million tokens, recorded by the operator: Foundry
                      publishes no sheet, and a blank means unknown, never free. */}
                  {providerLabel(config?.models.find((x) => x.id === m.id)?.provider)?.local && (
                    <span className="text-[10px] text-ok">$0 per token · priced by the hour</span>
                  )}
                  {!providerLabel(config?.models.find((x) => x.id === m.id)?.provider)?.local && (["price_in", "price_out"] as const).map((k) => (
                    <label key={k} className="flex items-center gap-1 text-[10px] text-faint">
                      <span>{k === "price_in" ? "$/M in" : "$/M out"}</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={config?.models.find((x) => x.id === m.id)?.[k] ?? ""}
                        placeholder="?"
                        onChange={(e) =>
                          config &&
                          save({
                            ...config,
                            models: config.models.map((x) =>
                              x.id === m.id ? { ...x, [k]: e.target.value === "" ? undefined : Number(e.target.value) } : x,
                            ),
                          })
                        }
                        className="focusable h-7 w-16 rounded-md border border-line-strong bg-field px-1.5 font-mono text-[11px] text-fg placeholder:text-ghost"
                      />
                    </label>
                  ))}
                  <span className="grow" />
                  {isDefault ? (
                    <span className="shrink-0 rounded-[3px] border border-line-strong px-1 py-px font-mono text-[9px] font-semibold text-dim">
                      DEFAULT
                    </span>
                  ) : (
                    <Button size="sm" variant="quiet" permission="configure" className="shrink-0" onClick={() => config && save({ ...config, default_model: m.id })}>
                      make default
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {catalogue !== null && shown.length > 80 && (
          <p className="px-4 py-2.5 text-[11px] text-faint">
            {shown.length - 80} more — narrow the search.
          </p>
        )}
      </div>
    </section>
  );
}

/* ═══════════════════ Keys ═══════════════════ */

function Keys() {
  const [keys, setKeys] = useState<VaultKey[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/vault")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(String(d.error)) : setKeys(d.keys ?? [])))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(refresh, [refresh]);

  const add = async () => {
    if (!name.trim() || !value) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), value, label }),
      });
      const d = await res.json();
      if (d.error) setError(String(d.error));
      else {
        setName("");
        setValue("");
        setLabel("");
        refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1 self-start">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <Icon name="key" size={15} className="text-dim" />
        <h2 className="text-[14px] font-semibold">Keys</h2>
        <span className="text-[11px] text-faint">
          referenced from specs as <code className="font-mono">{"${secret:name}"}</code>
        </span>
      </header>

      {error && (
        <div className="border-b border-line px-4 py-3">
          <Banner tone="err" title="The vault refused">
            <span className="whitespace-pre-wrap">{error}</span>
          </Banner>
        </div>
      )}

      <div className="flex flex-col">
        {keys === null && !error && (
          <div className="px-4 py-4" role="status" aria-label="Loading keys">
            <Skeleton lines={3} />
          </div>
        )}
        {keys?.length === 0 && (
          <p className="px-4 py-6 text-[12px] text-faint">
            Nothing yet. Keys set in the environment (<code className="font-mono">*_API_KEY</code>)
            appear here automatically.
          </p>
        )}
        {keys?.map((k) => (
          <div key={k.name} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
            <Status tone={k.set ? "ok" : "err"}>{k.set ? "Set" : "Missing"}</Status>
            <div className="flex min-w-0 grow flex-col">
              <div className="flex items-baseline gap-2">
                <code className="font-mono text-[12.5px] font-semibold text-fg">{k.name}</code>
                <code className="tnum truncate font-mono text-[11px] text-faint">{k.value}</code>
              </div>
              <span className="truncate text-[10.5px] text-faint">
                {[
                  k.label,
                  k.label.startsWith("from $") ? "supplied by the environment — manage it there" : "",
                  k.last_used ? `last used ${k.last_used.slice(0, 10)}` : "",
                  k.used_by?.length
                    ? `read by ${k.used_by.length} workflow${k.used_by.length === 1 ? "" : "s"}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || " "}
              </span>
            </div>
            {k.label.startsWith("from $") ? (
              <span className="shrink-0 font-mono text-[9.5px] text-ghost">env</span>
            ) : (
              <Button
                size="sm"
                variant="solid"
                tone="err"
                className="shrink-0"
                loading={removing === k.name}
                onClick={async () => {
                  if (confirming !== k.name) {
                    setConfirming(k.name);
                    return;
                  }
                  setConfirming(null);
                  setRemoving(k.name);
                  try {
                    await fetch(`/api/vault?name=${encodeURIComponent(k.name)}`, { method: "DELETE" });
                  } finally {
                    setRemoving(null);
                  }
                  refresh();
                }}
              >
                <Cross size={10} />
                {confirming === k.name ? "Click again to remove" : "Remove"}
              </Button>
            )}
          </div>
        ))}
      </div>

      <footer className="flex flex-col gap-2.5 border-t border-line bg-raise px-4 py-4">
        <div className="grid grid-cols-2 gap-2">
          <Row label="Name" tight hint="What specs will reference.">
            <Text mono value={name} placeholder="tavily" onChange={setName} />
          </Row>
          <Row label="Label" tight hint="What this credential is for.">
            <Text value={label} placeholder="Tavily search, GRC sandbox" onChange={setLabel} />
          </Row>
        </div>
        <Row label="Value" tight>
          <Input
            type="password"
            mono
            value={value}
            onChange={setValue}
            placeholder="pasted once, shown never"
            aria-label="Value"
            autoComplete="off"
          />
        </Row>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-faint">
            Any connector — including ones that do not exist yet — reads it as{" "}
            <code className="font-mono">{`\${secret:${name.trim() || "name"}}`}</code>
          </span>
          <span className="grow" />
          <Button size="sm" variant="solid" tone="ink" permission="configure" onClick={add} loading={busy} disabled={!name.trim() || !value}>
            Add key
          </Button>
        </div>
      </footer>
    </section>
  );
}
