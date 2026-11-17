"use client";

import { DATA_CLASS_STORED, PanelFailure, PanelNote, PermittedClass, PermittedClassNote, useConfigChanges } from "./providers";
import type { DataClass } from "@/lib/api/pending";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Status } from "./ui";
import { Checkbox, Input, Segmented } from "./forms";
import { QUIET } from "@/lib/quiet";
import { Pick } from "./select";
import { Cross, Row, Text } from "./builder/controls";
import { listVault, removeVaultKey, setVaultKey } from "@/lib/api/l2";

/**
 * The bodies of two of Configuration's panels (components/configuration.tsx):
 * the models this deployment offers, and the keys its connectors read. The
 * providers those models are served by are in components/providers.tsx.
 *
 * Models: what the configured providers serve, and a dropdown with
 * hundreds of entries is a way of choosing nothing. Whoever runs this
 * deployment picks the short list here; every model picker in the console
 * shows exactly that list and nothing else. A deployment starts with no
 * provider and no model, and each panel says so rather than naming one.
 *
 * Keys: named credentials, referenced from specs as ${secret:name}. Values
 * arrive here and leave masked — the only consumer of a live key is the
 * runtime, at the moment a tool is called.
 *
 * Both take `bare` from the page: true when the console has nothing behind
 * it, null while that is still being read (see Providers).
 */

interface CatalogueModel {
  id: string;
  label: string;
  context: number;
  price: number;
  price_out?: number;
  /** Provider id for models offered from an added provider; absent for a model the catalogue door lists. */
  provider?: string;
}

type ModelClass = "small" | "medium" | "large";
const MODEL_CLASSES: ModelClass[] = ["small", "medium", "large"];

interface Config {
  /** `max_data_class` (5.3) is read when the door answers one; it does not store it yet (components/providers.tsx). */
  models: { id: string; label: string; class?: ModelClass; price_in?: number; price_out?: number; provider?: string; max_data_class?: DataClass }[];
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

/* ═══════════════════ Models ═══════════════════ */

/** `onChanged` tells the page a write went through, so its own figures (the strip, the facts) are read again. */
export function OfferedModels({ bare = false, onChanged }: { bare?: boolean | null; onChanged?: () => void }) {
  const [catalogue, setCatalogue] = useState<CatalogueModel[] | null>(null);
  const [catalogueError, setCatalogueError] = useState("");
  const [config, setConfig] = useState<Config | null>(null);
  /** The configuration's read failed and an empty one stands in for it. A quiet console (lib/quiet.ts) says not connected instead of "none offered". */
  const [unread, setUnread] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("Name");
  const [savedTick, setSavedTick] = useState(false);
  const [lastGuard, setLastGuard] = useState(false);
  const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const queued = useRef<Config | null>(null);

  const reloadConfig = useCallback(() => {
    fetch("/api/config")
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        // A refusal or a fault answers without the list: the status, or the door's own words, is the reason.
        if (!d || !Array.isArray(d.models)) throw new Error(String(d?.error ?? `the server answered ${r.status}`));
        return d as Config;
      })
      .then((d) => {
        setUnread("");
        setConfig(d);
      })
      .catch((e) => {
        setUnread((e as Error).message);
        setConfig({ models: [], default_model: "" });
      });
  }, []);
  useConfigChanges(reloadConfig);
  useEffect(() => {
    reloadConfig();
    fetch("/api/models")
      .then(async (r) => {
        // A page (a proxy's 502, Next's own 404) is no answer and no message: the status alone is the reason.
        const d = await r.json().catch(() => null);
        if (!d) throw new Error(`the server answered ${r.status}`);
        return d;
      })
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
  const none = (config?.models.length ?? 0) === 0;
  // Quiet, with nothing behind the console: the offered list was not read from anywhere, so the panel does not say none is offered.
  const quietUnread = none && (bare === true || (QUIET && Boolean(unread)));
  // A deployment with no catalogue to list is not a fault: the door says its endpoint is not set, and the panel says there is nothing to browse.
  const noCatalogue = /not set/i.test(catalogueError);
  const providerLabel = useCallback((id?: string) => (config?.providers ?? []).find((p) => p.id === id), [config]);

  const shown = useMemo(() => {
    if (!catalogue) return [];
    // Models offered from added providers are not in the catalogue the door lists; they
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
  const push = useCallback(
    async (first: Config) => {
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
            onChanged?.();
          }
          next = queued.current;
          queued.current = null;
        }
      } finally {
        inFlight.current = false;
      }
    },
    [onChanged],
  );

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

  if (quietUnread) return <PanelNote />;
  // Not known yet whether anything is behind the console: no "none offered" in the meantime.
  if (catalogue === null || !config || (none && bare === null)) return <p className="px-4 py-3 text-[11.5px] text-faint">Reading the offered models&hellip;</p>;

  const chip = "shrink-0 rounded-[3px] border border-line-strong px-1 py-px font-mono text-[9px] font-semibold text-dim uppercase";

  // Nothing offered and nothing to browse: one line, no search over an empty list.
  if (none && catalogue.length === 0 && !unread && (QUIET || noCatalogue || !catalogueError)) {
    return (
      <p className="px-4 py-3 text-[12px] leading-[1.55] text-dim">
        No model is offered on this deployment yet, and it lists no catalogue to pick from. Add a provider under Providers and offer the models it serves; they appear here.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2">
        <span className="block w-64 max-w-full">
          <Text value={query} onChange={setQuery} placeholder="Search the catalogue" aria-label="Search the catalogue" />
        </span>
        {/* Segmented is uncontrolled by design — the wrapper reads the choice
            off the bubbling click so this panel can hold the sort itself. */}
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
        <span className="grow" />
        <span className={`text-[11px] transition-opacity ${savedTick ? "text-ok opacity-100" : "opacity-0"}`}>saved</span>
        <span className="tnum text-[11px] text-faint">{config.models.length} offered</span>
      </div>

      {unread && <PanelFailure title="The offered models could not be read">{unread}</PanelFailure>}
      {catalogueError && !noCatalogue && !QUIET && (
        <p className="border-b border-line px-4 py-2.5 text-[11.5px] leading-[1.5] text-warn">
          <span className="font-medium">The catalogue could not be read.</span> {catalogueError}. The offered list still works; only browsing is unavailable.
        </p>
      )}
      {lastGuard && <p className="border-b border-line px-4 py-2.5 text-[11.5px] leading-[1.5] text-warn">At least one model must stay offered.</p>}

      <div className="max-h-[460px] overflow-y-auto border-b border-line">
        {shown.slice(0, 80).map((m) => {
          const on = chosen.has(m.id);
          const offered = config.models.find((x) => x.id === m.id);
          const isDefault = config.default_model === m.id;
          // Every tier this model is the router's pick for: its own, and any other tier that names it.
          const defaultFor = MODEL_CLASSES.filter((c) => config.class_defaults?.[c] === m.id);
          const local = providerLabel(offered?.provider)?.local;
          return (
            <div
              key={m.id}
              className={`flex flex-col gap-1.5 border-b border-line px-4 py-2 last:border-b-0 ${
                on ? "" : "opacity-75"
              }`}
            >
              {/* Identity and price on one line; long catalogue names truncate
                  rather than push anything past the panel edge. */}
              <div className="flex min-w-0 items-center gap-3">
                <Checkbox checked={on} onChange={() => toggle(m)} aria-label={`Offer ${m.label}`} />
                <div className="flex min-w-0 grow flex-col">
                  <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-fg" title={m.label}>
                    <span className="min-w-0 truncate">{m.label}</span>
                    {m.provider && (
                      <span
                        className={`shrink-0 rounded-[3px] border px-1 py-px font-mono text-[9px] font-semibold ${providerLabel(m.provider)?.local ? "border-ok/40 text-ok" : "border-line-strong text-dim"}`}
                        title={providerLabel(m.provider) ? "Served by this provider" : m.provider === "other" ? "Offered, and neither the catalogue nor a configured provider lists it" : "The provider this model names is not configured"}
                      >
                        {providerLabel(m.provider)?.label ?? (m.provider === "other" ? "no provider" : m.provider)}
                      </span>
                    )}
                    {on && isDefault && (
                      <span className={chip} title="The model a run uses when its step names neither a model nor a tier">
                        run default
                      </span>
                    )}
                    {on &&
                      defaultFor.map((c) => (
                        <span key={c} className={chip} title={`The model the router picks for the ${c} tier`}>
                          {c} tier default
                        </span>
                      ))}
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
              {on && offered && (
                <div className="flex flex-wrap items-center gap-2 pl-7">
                  <div className="w-32">
                    <Pick
                      aria-label={`Tier of ${m.label}`}
                      value={offered.class ?? ""}
                      onChange={(v) =>
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
                  {/* Cost per million tokens, recorded by the operator: no provider
                      publishes a sheet the console reads, and a blank means unknown, never free. */}
                  {local && <span className="text-[10px] text-ok">$0 per token · priced by the hour</span>}
                  {!local && (["price_in", "price_out"] as const).map((k) => (
                    <label key={k} className="flex items-center gap-1 text-[10px] text-faint">
                      <span>{k === "price_in" ? "$/M in" : "$/M out"}</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={offered[k] ?? ""}
                        placeholder="unpriced"
                        onChange={(e) =>
                          save({
                            ...config,
                            models: config.models.map((x) =>
                              x.id === m.id ? { ...x, [k]: e.target.value === "" ? undefined : Number(e.target.value) } : x,
                            ),
                          })
                        }
                        className="focusable h-7 w-[88px] rounded-md border border-line-strong bg-field px-1.5 font-mono text-[11px] text-fg placeholder:text-ghost"
                      />
                    </label>
                  ))}
                  <PermittedClass
                    value={offered.max_data_class}
                    label={`Permitted data class of ${m.label}`}
                    onChange={(v) =>
                      // Written only once the door keeps the field; the control is disabled until then.
                      DATA_CLASS_STORED && save({ ...config, models: config.models.map((x) => (x.id === m.id ? { ...x, max_data_class: v || undefined } : x)) })
                    }
                  />
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {offered.class && config.class_defaults?.[offered.class] !== m.id && (
                      <Button
                        size="sm"
                        variant="quiet"
                        className="shrink-0"
                        permission="configure"
                        onClick={() => save({ ...config, class_defaults: { ...(config.class_defaults ?? {}), [offered.class!]: m.id } })}
                      >
                        Make {offered.class} tier default
                      </Button>
                    )}
                    {!isDefault && (
                      <Button size="sm" variant="quiet" permission="configure" className="shrink-0" onClick={() => save({ ...config, default_model: m.id })}>
                        Make run default
                      </Button>
                    )}
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="px-4 py-3 text-[12px] leading-[1.55] text-dim">
            {query.trim() ? "Nothing matches that search." : "No model is offered on this deployment yet."}
          </p>
        )}
        {shown.length > 80 && (
          <p className="px-4 py-2.5 text-[11px] text-faint">
            {shown.length - 80} more: narrow the search.
          </p>
        )}
      </div>
      <p className="flex px-4 py-2.5">
        <PermittedClassNote short />
      </p>
    </>
  );
}

/* ═══════════════════ Keys ═══════════════════ */

export function Keys({ bare = false, onChanged }: { bare?: boolean | null; onChanged?: () => void }) {
  const [keys, setKeys] = useState<VaultKey[] | null>(null);
  /** The vault did not answer the read. */
  const [unread, setUnread] = useState("");
  /** The vault refused a write. */
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listVault()
      .then((v) => {
        setKeys(v.keys);
        setUnread("");
      })
      .catch((e: Error) => setUnread(e.message));
  }, []);

  useEffect(refresh, [refresh]);

  const add = async () => {
    if (!name.trim() || !value) return;
    setBusy(true);
    setError("");
    try {
      await setVaultKey(name.trim(), value, label);
      setName("");
      setValue("");
      setLabel("");
      setAdding(false);
      refresh();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const none = (keys?.length ?? 0) === 0;
  // Quiet: the vault was not read (the console is bare, or the read failed), so the panel does not say it is empty.
  if (none && !adding && (bare === true || (QUIET && Boolean(unread)))) return <PanelNote />;
  if (keys === null && unread) return <PanelFailure title="The vault could not be read">{unread}</PanelFailure>;
  // Not known yet whether anything is behind the console: no "the vault is empty" in the meantime.
  if (keys === null || (none && bare === null && !adding)) return <p className="px-4 py-3 text-[11.5px] text-faint">Reading the vault&hellip;</p>;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2 last:border-b-0">
        {none ? (
          <span className="min-w-0 max-w-[92ch] text-[12px] leading-[1.55] text-dim">
            The vault is empty. Keys set in the environment (<code className="font-mono text-[11px]">*_API_KEY</code>) appear here on their own.
          </span>
        ) : (
          <>
            <span className="tnum text-[11px] text-faint">{keys.length === 1 ? "1 key" : `${keys.length} keys`}</span>
            <span className="text-[11px] text-faint">
              referenced from specs as <code className="font-mono">{"${secret:name}"}</code>
            </span>
          </>
        )}
        <span className="grow" />
        {!adding && (
          <Button size="sm" variant="solid" tone="ink" permission="configure" onClick={() => setAdding(true)}>
            Add a key
          </Button>
        )}
      </div>

      {adding && (
        <form
          className="flex flex-col gap-2.5 border-b border-line bg-raise/40 px-4 py-3 last:border-b-0"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
            <Row label="Name" tight hint="What specs will reference.">
              <Text mono value={name} placeholder="key-name" onChange={setName} />
            </Row>
            <Row label="Label" tight hint="What this credential is for.">
              <Text value={label} placeholder="The system it opens" onChange={setLabel} />
            </Row>
            <Row label="Value" tight hint="Kept by the vault and shown masked from then on.">
              <Input type="password" mono value={value} onChange={setValue} placeholder="pasted once, shown never" aria-label="Value" autoComplete="off" />
            </Row>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant="solid" tone="ink" permission="configure" loading={busy} disabled={!name.trim() || !value}>
              Add key
            </Button>
            <Button
              size="sm"
              variant="solid"
              tone="err"
              onClick={() => {
                setAdding(false);
                setError("");
              }}
            >
              Cancel
            </Button>
            <span className="text-[11px] text-faint">
              Any connector, including ones that do not exist yet, reads it as <code className="font-mono">{`\${secret:${name.trim() || "name"}}`}</code>
            </span>
          </div>
        </form>
      )}

      {error && <PanelFailure title="The vault refused">{error}</PanelFailure>}
      {unread && <PanelFailure title="The vault could not be read again">{unread}</PanelFailure>}

      {keys.map((k) => (
        <div key={k.name} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
          <Status tone={k.set ? "ok" : "err"}>{k.set ? "Set" : "Missing"}</Status>
          <div className="flex min-w-0 grow flex-col">
            <div className="flex items-baseline gap-2">
              <code className="font-mono text-[12px] font-semibold text-fg">{k.name}</code>
              <code className="tnum truncate font-mono text-[11px] text-faint">{k.value}</code>
            </div>
            <span className="truncate text-[10.5px] text-faint">
              {[
                k.label,
                k.label.startsWith("from $") ? "supplied by the environment: manage it there" : "",
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
              permission="configure"
              loading={removing === k.name}
              onClick={async () => {
                if (confirming !== k.name) {
                  setConfirming(k.name);
                  return;
                }
                setConfirming(null);
                setRemoving(k.name);
                try {
                  // A refusal is said by the console's guard (401, 403); the list is read again either way.
                  await removeVaultKey(k.name).catch(() => {});
                } finally {
                  setRemoving(null);
                }
                refresh();
                onChanged?.();
              }}
            >
              <Cross size={10} />
              {confirming === k.name ? "Click again to remove" : "Remove"}
            </Button>
          )}
        </div>
      ))}
    </>
  );
}
