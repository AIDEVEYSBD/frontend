"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui";
import { Segmented } from "./forms";
import { Icon } from "./builder/icons";
import { Cross, Mini, Row, Text } from "./builder/controls";

/**
 * The factory's configuration: which models it offers, and the keys its
 * connectors read.
 *
 * Models: the OpenRouter catalogue is hundreds of entries, and a dropdown with
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
}

interface Config {
  models: { id: string; label: string }[];
  default_model: string;
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
    <div className="min-h-full">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-10">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Configuration</h1>
          <p className="max-w-[620px] text-[13.5px] leading-relaxed text-dim">
            What this factory offers to every agent built on it: the models teams may pick from,
            and the keys connectors read at run time.
          </p>
        </header>

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

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig({ models: [], default_model: "" }));
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
  }, []);

  const chosen = useMemo(() => new Set((config?.models ?? []).map((m) => m.id)), [config]);

  const shown = useMemo(() => {
    if (!catalogue) return [];
    const q = query.trim().toLowerCase();
    const rows = q
      ? catalogue.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
      : catalogue;
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
  }, [catalogue, query, chosen, sort]);

  // Writes go out one at a time and a burst of ticks collapses to the latest
  // config — the UI is optimistic, the wire is serialized, last one wins.
  const push = useCallback(async (next: Config) => {
    if (inFlight.current) {
      queued.current = next;
      return;
    }
    inFlight.current = true;
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        setSavedTick(true);
        setTimeout(() => setSavedTick(false), 1200);
      }
    } finally {
      inFlight.current = false;
      const q = queued.current;
      queued.current = null;
      if (q) void push(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      : [...config.models, { id: m.id, label: m.label }];
    save({
      models,
      default_model: models.some((x) => x.id === config.default_model)
        ? config.default_model
        : models[0].id,
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
          Pulled live from the OpenRouter catalogue. Tick what this factory offers — every model
          dropdown in the builder shows exactly this list. At a client, the same list points at
          their Bedrock or Foundry deployment instead; specs name a model, never a provider.
          Prices are per million tokens from the gateway&rsquo;s sheet.
        </p>
        <Text value={query} onChange={setQuery} placeholder="Search the catalogue" />
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
          <p className="rounded-md border border-warn-line bg-warn-bg px-2.5 py-2 text-[11.5px] text-warn">
            {catalogueError} — the selected list still works; only browsing is unavailable.
          </p>
        )}
      </div>

      {lastGuard && (
        <p className="border-b border-warn-line bg-warn-bg px-4 py-1.5 text-[11.5px] text-warn">
          At least one model must stay offered.
        </p>
      )}

      <div className="max-h-[460px] min-h-[200px] overflow-y-auto">
        {catalogue === null && <p className="px-4 py-6 text-[12px] text-faint">Loading the catalogue…</p>}
        {shown.slice(0, 80).map((m) => {
          const on = chosen.has(m.id);
          const isDefault = config?.default_model === m.id;
          return (
            <div
              key={m.id}
              className={`flex items-center gap-3 border-b border-line/70 px-4 py-2 last:border-b-0 ${
                on ? "" : "opacity-75"
              }`}
            >
              <button
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(m)}
                className={`focusable grid size-4 shrink-0 cursor-pointer place-items-center rounded-[3px] border transition-colors ${
                  on ? "border-fg bg-fg" : "border-line-strong bg-field"
                }`}
              >
                {on && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--t-on-ink)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
              <div className="flex min-w-0 grow flex-col">
                <span className="truncate text-[12.5px] font-medium text-fg">{m.label}</span>
                <span className="truncate font-mono text-[10.5px] text-faint">{m.id}</span>
              </div>
              {m.context > 0 && (
                <span className="tnum hidden shrink-0 font-mono text-[10px] text-ghost sm:inline">
                  {Math.round(m.context / 1000)}k ctx
                </span>
              )}
              {m.price > 0 && (
                <span className="tnum hidden shrink-0 font-mono text-[10px] text-ghost sm:inline">
                  {(m.price_out ?? 0) > 0
                    ? `$${m.price.toFixed(2)} in · $${(m.price_out ?? 0).toFixed(2)} out /M`
                    : `$${m.price.toFixed(2)}/M in`}
                </span>
              )}
              {on &&
                (isDefault ? (
                  <span className="shrink-0 rounded-[3px] border border-line-strong px-1 py-px font-mono text-[9px] font-semibold text-dim">
                    DEFAULT
                  </span>
                ) : (
                  <button
                    onClick={() => config && save({ ...config, default_model: m.id })}
                    className="focusable shrink-0 cursor-pointer font-mono text-[9.5px] text-faint underline decoration-line-strong underline-offset-2 hover:text-fg"
                  >
                    make default
                  </button>
                ))}
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
        <div className="border-b border-line bg-err-bg px-4 py-2.5">
          <p className="text-[12px] whitespace-pre-wrap text-err">{error}</p>
        </div>
      )}

      <div className="flex flex-col">
        {keys === null && !error && <p className="px-4 py-6 text-[12px] text-faint">Loading…</p>}
        {keys?.length === 0 && (
          <p className="px-4 py-6 text-[12px] text-faint">
            Nothing yet. Keys set in the environment (<code className="font-mono">*_API_KEY</code>)
            appear here automatically.
          </p>
        )}
        {keys?.map((k) => (
          <div key={k.name} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
            <span className={`size-1.5 shrink-0 rounded-[2px] ${k.set ? "bg-ok" : "bg-err"}`} />
            <div className="flex min-w-0 grow flex-col">
              <div className="flex items-baseline gap-2">
                <code className="font-mono text-[12.5px] font-semibold text-fg">{k.name}</code>
                <code className="tnum truncate font-mono text-[11px] text-faint">{k.value}</code>
              </div>
              <span className="truncate text-[10.5px] text-faint">
                {[
                  k.label,
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
              <span className="shrink-0 font-mono text-[9.5px] text-ghost" title="Supplied by the environment; manage it there.">
                env
              </span>
            ) : (
              <>
                {confirming === k.name && (
                  <span className="shrink-0 text-[10.5px] font-medium text-err">
                    Click again to remove
                  </span>
                )}
                <Mini
                  label={confirming === k.name ? `Confirm removing ${k.name}` : `Remove ${k.name}`}
                  tone="err"
                  onClick={() => {
                    if (confirming !== k.name) {
                      setConfirming(k.name);
                      return;
                    }
                    setConfirming(null);
                    fetch(`/api/vault?name=${encodeURIComponent(k.name)}`, { method: "DELETE" }).then(refresh);
                  }}
                >
                  <Cross size={10} />
                </Mini>
              </>
            )}
          </div>
        ))}
      </div>

      <footer className="flex flex-col gap-2.5 border-t border-line bg-raise/40 px-4 py-4">
        <div className="grid grid-cols-2 gap-2">
          <Row label="Name" tight hint="What specs will reference.">
            <Text mono value={name} placeholder="tavily" onChange={setName} />
          </Row>
          <Row label="Label" tight hint="What this credential is for.">
            <Text value={label} placeholder="Tavily search, GRC sandbox" onChange={setLabel} />
          </Row>
        </div>
        <Row label="Value" tight>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="pasted once, shown never"
            className="h-8 w-full rounded-md border border-line-strong bg-field px-2.5 font-mono text-[12px] text-fg transition-colors placeholder:text-ghost focus:border-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-fg/15"
          />
        </Row>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-faint">
            Any connector — including ones that do not exist yet — reads it as{" "}
            <code className="font-mono">{`\${secret:${name.trim() || "name"}}`}</code>
          </span>
          <span className="grow" />
          <Button size="sm" variant="solid" tone="ink" onClick={add} loading={busy} disabled={!name.trim() || !value}>
            Add key
          </Button>
        </div>
      </footer>
    </section>
  );
}
