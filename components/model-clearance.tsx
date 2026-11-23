"use client";

import { useCallback, useEffect, useState } from "react";
import { errorText } from "@/lib/api/client";
import { DATA_CLASSES, type DataClass } from "@/lib/api/pending";
import { Button, Mono } from "./ui";
import { Checkbox } from "./forms";
import { Pick } from "./select";
import { announceConfig, useConfigChanges } from "./providers";

/**
 * The classes of data each offered model may be sent, and the models its
 * calls fall back to, in order (agentfactory/modelconfig.py). Part of
 * Configuration's Models panel, under the offered list.
 *
 * Both are saved with the rest of the model settings (`POST /api/config`,
 * the whole list of models with each one's `cleared_for` and `fallbacks`).
 * The service keeps a model cleared for public and internal data when it is
 * given no class, so a model here always keeps at least one class ticked.
 * A model cannot fall back to itself and the fallbacks may not form a cycle:
 * the service refuses both and stores nothing, and the refusal is shown in
 * its words. A fallback naming a model no longer offered is not stored, and
 * the answer's `dropped` says so.
 */

interface Model {
  id: string;
  label: string;
  cleared_for: DataClass[];
  fallbacks: string[];
  [key: string]: unknown;
}

type Rec = Record<string, unknown>;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function ModelClearance({ onSaved }: { /** A save went through: the page reads the model settings again. */ onSaved: () => void }) {
  const [stored, setStored] = useState<Model[] | null>(null);
  const [draft, setDraft] = useState<Model[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  const adopt = useCallback((models: unknown) => {
    const list = (Array.isArray(models) ? models : []).map((m) => {
      const r = m as Rec;
      return { ...r, id: String(r.id), label: String(r.label || r.id), cleared_for: (Array.isArray(r.cleared_for) ? r.cleared_for : []) as DataClass[], fallbacks: (Array.isArray(r.fallbacks) ? r.fallbacks : []) as string[] };
    });
    setStored(list);
    setDraft(list);
  }, []);

  const reload = useCallback(() => {
    fetch("/api/config")
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as Rec | null;
        if (!r.ok || !d || !Array.isArray(d.models)) throw new Error(errorText(d, r, "GET", "/api/config"));
        return d;
      })
      .then((d) => {
        setError("");
        adopt(d.models);
      })
      .catch((e: Error) => setError(e.message));
  }, [adopt]);
  useEffect(reload, [reload]);
  // Another panel saved the model settings (an offered model, a price): read them again, so this list is never stale when it posts.
  useConfigChanges(reload);

  const dirty = stored !== null && draft.some((m, i) => !same(m.cleared_for, stored[i]?.cleared_for ?? []) || !same(m.fallbacks, stored[i]?.fallbacks ?? []));
  const edit = (id: string, change: (m: Model) => Partial<Model>) => setDraft((ms) => ms.map((m) => (m.id === id ? { ...m, ...change(m) } : m)));

  const save = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const r = await fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ models: draft }) });
      const d = (await r.json().catch(() => null)) as Rec | null;
      if (!r.ok || !d) throw new Error(errorText(d, r, "POST", "/api/config"));
      adopt(d.models);
      const dropped = ((d.dropped as Rec | undefined)?.fallbacks ?? null) as Record<string, Record<string, string>> | null;
      setSaid(
        dropped && Object.keys(dropped).length
          ? { tone: "warn", text: `Saved, except these fallbacks: ${Object.entries(dropped).flatMap(([m, fs]) => Object.values(fs).map((why) => `${m}: ${why}`)).join("; ")}.` }
          : { tone: "ok", text: "Saved. Calls use the new clearances and fallbacks from now." },
      );
      announceConfig();
      onSaved();
    } catch (e) {
      setSaid({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (error && stored === null) return <p className="border-t border-line px-4 py-2.5 text-[11.5px] leading-[1.5] text-err"><span className="font-medium">The clearances and fallbacks could not be read.</span> {error}</p>;
  if (stored === null) return <p className="border-t border-line px-4 py-3 text-[11.5px] text-faint">Reading the clearances and fallbacks…</p>;
  if (!stored.length) return null;

  return (
    <div className="flex flex-col border-t border-line">
      <div className="flex flex-wrap items-start gap-3 border-b border-line bg-raise/40 px-4 py-2">
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="text-[12px] font-semibold text-fg">Clearance and fallbacks</span>
          <span className="max-w-[110ch] text-[11px] leading-[1.55] text-faint">
            A model is sent only the classes of data it is cleared for. A run&rsquo;s call that carries a class its model is not cleared for goes to the first of that model&rsquo;s fallbacks that is; when none is, the call is not made. A run&rsquo;s call to a model that does not answer (unreachable, timed out, rate limited or failing on its side) goes to the next cleared model in its chain. The application gateway uses the fallbacks for clearance only, and only to a model the application&rsquo;s policy lists; a model that fails there is answered as a failure.
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {dirty && (
            <Button size="sm" variant="solid" tone="err" disabled={busy} onClick={() => setDraft(stored)}>
              Discard
            </Button>
          )}
          <Button size="sm" variant="solid" tone="ink" permission="configure" loading={busy} disabled={!dirty} onClick={save}>
            Save clearances and fallbacks
          </Button>
        </span>
      </div>
      {said && <p className={`border-b border-line px-4 py-2 text-[11.5px] leading-[1.5] ${said.tone === "ok" ? "text-ok" : said.tone === "warn" ? "text-warn" : "text-err"}`} role={said.tone === "err" ? "alert" : undefined}>{said.tone === "err" ? <><span className="font-medium">Not saved.</span> {said.text}</> : said.text}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] text-faint">
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Cleared for</th>
              <th className="px-3 py-2 font-medium">Falls back to, in order</th>
            </tr>
          </thead>
          <tbody>
            {draft.map((m) => {
              const others = draft.filter((o) => o.id !== m.id && !m.fallbacks.includes(o.id));
              return (
                <tr key={m.id} className="border-b border-line align-top last:border-0">
                  <td className="px-4 py-2">
                    <span className="block text-[12px] text-fg">{m.label}</span>
                    <Mono className="text-[10px] text-faint">{m.id}</Mono>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {DATA_CLASSES.map((c) => {
                        const on = m.cleared_for.includes(c);
                        const last = on && m.cleared_for.length === 1;
                        return (
                          <Checkbox
                            key={c}
                            label={c}
                            checked={on}
                            disabled={last}
                            aria-label={`${m.id} cleared for ${c}`}
                            onChange={() => edit(m.id, (x) => ({ cleared_for: on ? x.cleared_for.filter((y) => y !== c) : DATA_CLASSES.filter((y) => y === c || x.cleared_for.includes(y)) }))}
                          />
                        );
                      })}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {m.fallbacks.map((f, i) => (
                        <span key={f} className="inline-flex items-center gap-1 rounded-sm border border-line bg-canvas py-0.5 pr-0.5 pl-1.5">
                          <span className="tnum text-[10px] text-faint">{i + 1}</span>
                          <Mono className="text-[10.5px]">{f}</Mono>
                          {i > 0 && (
                            <Button size="sm" variant="quiet" onClick={() => edit(m.id, (x) => ({ fallbacks: [...x.fallbacks.slice(0, i - 1), f, x.fallbacks[i - 1], ...x.fallbacks.slice(i + 1)] }))}>
                              Earlier
                            </Button>
                          )}
                          <Button size="sm" variant="solid" tone="err" onClick={() => edit(m.id, (x) => ({ fallbacks: x.fallbacks.filter((y) => y !== f) }))}>
                            Remove
                          </Button>
                        </span>
                      ))}
                      {!m.fallbacks.length && <span className="text-[11px] text-faint">none</span>}
                      {others.length > 0 && (
                        <span className="w-44">
                          <Pick value="" onChange={(v) => v && edit(m.id, (x) => ({ fallbacks: [...x.fallbacks, v] }))} options={[{ value: "", label: "add a fallback" }, ...others.map((o) => ({ value: o.id, label: o.label }))]} aria-label={`Add a fallback for ${m.id}`} />
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[10.5px] leading-[1.5] text-faint">A model is cleared for at least one class; given none, the service clears it for public and internal data. A model cannot fall back to itself, and the fallbacks may not form a cycle.</p>
    </div>
  );
}
