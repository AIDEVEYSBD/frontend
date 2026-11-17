"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Status, Tag } from "./ui";
import { BrandMark } from "./brand";
import { Text } from "./builder/controls";
import { QUIET } from "@/lib/quiet";
import type { VertexAnswer, VertexGroup } from "@/app/api/providers/vertex/route";

/**
 * What the Vertex connection can see (app/api/providers/vertex/route.ts).
 *
 * The console's server reads the list with its own Google identity, so this
 * shows the models the moment the deployment can reach Vertex AI, before any
 * of them is offered to agents or routed to. It states that plainly: these
 * are detected, not in use. With no connection it shows nothing in a quiet
 * console and one line otherwise.
 */

let cached: VertexAnswer | null = null;

export function useVertex(): { answer: VertexAnswer | null; busy: boolean; reload: () => void } {
  const [answer, setAnswer] = useState<VertexAnswer | null>(cached);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (cached && tick === 0) return;
    let live = true;
    fetch(`/api/providers/vertex${tick ? "?fresh=1" : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: VertexAnswer | null) => {
        if (!live) return;
        if (d && Array.isArray(d.groups)) {
          cached = d;
          setAnswer(d);
        }
      })
      .catch(() => {})
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [tick]);
  return { answer, busy, reload: () => { setBusy(true); setTick((t) => t + 1); } };
}

const SOURCE: Record<string, string> = {
  metadata: "this deployment's own service account",
  file: "a credentials file on this server",
  token: "a token handed to this server",
};

/** Drawn inside a panel that already has a card: the Providers panel on Configuration. */
export function VertexDetected() {
  const { answer, busy, reload } = useVertex();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string>("");

  const groups = useMemo(() => (answer?.groups ?? []).filter((g) => !g.error && g.models.length > 0), [answer]);
  const current: VertexGroup | undefined = groups.find((g) => g.id === open) ?? groups[0];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = current?.models ?? [];
    return needle ? rows.filter((m) => m.id.toLowerCase().includes(needle) || m.label.toLowerCase().includes(needle)) : rows;
  }, [current, q]);

  if (!answer) return null;
  if (!answer.connected) {
    if (QUIET) return null;
    const refused = answer.groups.find((g) => g.error);
    const line = answer.source
      ? `This server has a Google identity${answer.account ? ` (${answer.account})` : ""}, but Vertex AI did not list any model to it${refused?.error ? `: ${refused.error}` : ""}.`
      : "This server has no Google identity, so nothing is detected from Vertex AI.";
    return <p className="border-b border-line px-4 py-3 text-[11.5px] leading-[1.55] text-faint">{line}</p>;
  }

  const total = groups.reduce((n, g) => n + g.models.length, 0);
  const body = (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-3">
        <BrandMark name="Google Cloud" size={16} />
        <span className="text-[12.5px] font-semibold text-fg">Google Vertex AI</span>
        <Status tone="ok">Connected</Status>
        <span className="tnum text-[11.5px] text-dim">
          {total} model{total === 1 ? "" : "s"} detected
        </span>
        <span className="grow" />
        <Button size="sm" variant="solid" tone="neutral" loading={busy} onClick={reload}>
          Check again
        </Button>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 border-b border-line px-4 py-2.5 text-[11.5px] sm:grid-cols-3">
        <Fact term="Project" value={answer.project} />
        <Fact term="Region" value={answer.region || "global"} />
        <Fact term="Acting as" value={answer.account || SOURCE[answer.source ?? ""] || ""} title={SOURCE[answer.source ?? ""]} />
      </dl>
      {groups.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
            {groups.map((g) => {
              const on = g.id === current?.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setOpen(g.id)}
                  className={`focusable flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11.5px] font-medium ${on ? "border-fg bg-fg text-canvas" : "border-line-strong bg-raise text-fg hover:bg-field"}`}
                >
                  {g.label}
                  <span className={`tnum text-[10.5px] ${on ? "opacity-70" : "text-faint"}`}>{g.models.length}</span>
                </button>
              );
            })}
            <span className="grow" />
            <span className="block w-[200px]">
              <Text value={q} onChange={setQ} placeholder="Filter models" aria-label="Filter the detected models" />
            </span>
          </div>
          <div className="max-h-[340px] overflow-y-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-[10.5px] text-faint">
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">{current?.kind === "deployed" ? "Serving" : "Version"}</th>
                  <th className="px-3 py-2 font-medium">{current?.kind === "publisher" ? "Stage" : "Resource"}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.name} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">
                      <span className="font-mono text-[11.5px] text-fg">{m.label}</span>
                    </td>
                    <td className="tnum px-3 py-2 text-dim">{m.version ?? <span className="text-ghost">not stated</span>}</td>
                    <td className="px-3 py-2">
                      {current?.kind === "publisher" ? (
                        m.stage ? <Tag tone={m.stage === "GA" ? "ok" : "neutral"}>{m.stage}</Tag> : <span className="text-ghost">not stated</span>
                      ) : (
                        <span className="font-mono text-[10.5px] text-faint">{m.id}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-faint">
                      No detected model matches &ldquo;{q}&rdquo;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="border-t border-line px-4 py-2.5 text-[11.5px] leading-[1.55] text-faint">
        Detected on the connection, nothing more: these are the models Vertex AI lists to this deployment. None is offered to agents or has been called from
        here until it is added to the offered models.
      </p>
    </div>
  );

  return <div className="border-b border-line">{body}</div>;
}

function Fact({ term, value, title }: { term: string; value: string; title?: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2" title={title}>
      <dt className="shrink-0 text-faint">{term}</dt>
      <dd className="min-w-0 truncate font-mono text-[11px] text-fg">{value || <span className="text-ghost">not stated</span>}</dd>
    </span>
  );
}
