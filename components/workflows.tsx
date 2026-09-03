"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./builder/icons";
import { IconButton, Label, RUN_STATE, Status } from "./ui";
import { Banner } from "./overlays";

/**
 * The registry, as a page.
 *
 * Every saved agent, one card each. Clicking a card does the one thing people
 * come here for — it opens the workflow in the builder. The rarer verbs (run,
 * benchmark, export, delete) live behind the kebab in the corner and behind
 * right-click.
 *
 * These are the same files `agent.invoke` chains at run time. Deleting here
 * breaks any workflow that calls the deleted one — the menu says so.
 */

interface SavedAgent {
  id: string;
  name: string;
  description: string;
  nodes: number;
}

interface RunRow {
  id: string;
  system: string;
  state: string;
  at: string;
}

interface MenuAt {
  agent: SavedAgent;
  x: number;
  y: number;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function Workflows() {
  const [agents, setAgents] = useState<SavedAgent[] | null>(null);
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const router = useRouter();

  const refresh = useCallback(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(String(d.error)) : setAgents(d.agents ?? [])))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then((d) => setRuns(d.runs ?? []))
      .catch(() => setRuns([]));
  }, []);

  const openMenu = useCallback((agent: SavedAgent, x: number, y: number) => {
    const pad = 8;
    setConfirming(null);
    setMenu({
      agent,
      x: Math.max(pad, Math.min(x, window.innerWidth - 240 - pad)),
      y: Math.max(pad, Math.min(y, window.innerHeight - 240 - pad)),
    });
  }, []);

  const lastRunOf = useCallback(
    (id: string) =>
      (runs ?? []).reduce<RunRow | null>(
        (best, r) => (r.system === id && (!best || r.at > best.at) ? r : best),
        null,
      ),
    [runs],
  );

  const remove = async (id: string) => {
    await fetch(`/api/agents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setMenu(null);
    setConfirming(null);
    refresh();
  };

  const exportJson = async (id: string) => {
    const d = await fetch(`/api/agents?id=${encodeURIComponent(id)}`).then((r) => r.json());
    if (d.error) return;
    const blob = new Blob([JSON.stringify(d.spec, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMenu(null);
  };

  return (
    <div className="min-h-full">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-7 px-4 py-8 sm:px-6 lg:px-10">
        <header className="flex items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Workflows</h1>
            <p className="max-w-[620px] text-[13.5px] leading-relaxed text-dim">
              Every saved agent. Open one to see it built from the standard cards, run it, or chain
              it from another workflow — these are the same specs <code className="font-mono text-[12px]">agent.invoke</code> runs.
            </p>
          </div>
          <span className="grow" />
          <span className="tnum shrink-0 pb-1 font-mono text-[11px] text-faint">
            {agents ? `${agents.length} saved` : "…"}
          </span>
        </header>

        {error && (
          <Banner tone="err" title="Could not read the registry">
            {error}
          </Banner>
        )}

        {agents?.length === 0 && (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line-strong px-6 py-10">
            <p className="text-[14px] font-medium text-fg">Nothing saved yet.</p>
            <p className="max-w-[480px] text-[12.5px] leading-relaxed text-faint">
              Build an agent and press Save — it lands here, appears in the builder&rsquo;s
              Workflows rail, and becomes callable from other workflows.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(agents ?? []).map((a) => {
            const last = lastRunOf(a.id);
            const state = last ? (RUN_STATE[last.state] ?? { tone: "neutral" as const, label: last.state }) : null;
            return (
              <div key={a.id} className="relative">
                <button
                  type="button"
                  onClick={() => router.push(`/builder?load=${encodeURIComponent(a.id)}`)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMenu(a, e.clientX, e.clientY);
                  }}
                  className={`focusable flex h-full w-full cursor-pointer flex-col gap-3 rounded-lg border bg-surface p-4 text-left transition-[border-color,box-shadow,transform] duration-200 ease-[var(--ease-out)] hover:-translate-y-px hover:elev-2 ${
                    menu?.agent.id === a.id ? "border-line-strong elev-2" : "border-line elev-1"
                  }`}
                >
                  <div className="flex items-start gap-2.5 pr-8">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-raise text-dim">
                      <Icon name="workflow" size={16} />
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[14px] font-semibold text-fg">{a.name}</span>
                      <span className="truncate font-mono text-[10.5px] text-faint">{a.id}</span>
                    </div>
                  </div>
                  {/* Never clip prose while the card has room — a cropped
                      sentence on a spacious card is an amateur tell. */}
                  {a.description && (
                    <p className="text-[12px] leading-[1.55] text-dim">{a.description}</p>
                  )}
                  <div className="mt-auto flex items-center gap-2.5 border-t border-line pt-2.5">
                    <span className="tnum font-mono text-[10.5px] text-faint">
                      {a.nodes} node{a.nodes === 1 ? "" : "s"}
                    </span>
                    <span className="grow" />
                    {last && state ? (
                      <>
                        <Status tone={state.tone}>{state.label}</Status>
                        <span className="tnum font-mono text-[10px] text-faint">
                          last run {ago(last.at)}
                        </span>
                      </>
                    ) : (
                      <span className="font-mono text-[10px] text-faint">
                        {runs === null ? "…" : "never run"}
                      </span>
                    )}
                  </div>
                </button>
                <IconButton
                  label="Actions"
                  size="sm"
                  className="absolute top-2.5 right-2.5"
                  onClick={(e) => {
                    // Anchor to the kebab itself — keyboard activation reports
                    // (0,0), and even a pointer click reads best from here.
                    const rect = e.currentTarget.getBoundingClientRect();
                    openMenu(a, rect.right - 236, rect.bottom + 4);
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </IconButton>
              </div>
            );
          })}
        </div>
      </div>

      {menu && (
        <ContextMenu
          at={menu}
          confirming={confirming === menu.agent.id}
          onClose={() => {
            setMenu(null);
            setConfirming(null);
          }}
          onOpen={() => router.push(`/builder?load=${encodeURIComponent(menu.agent.id)}`)}
          onRun={() => router.push(`/runs?agent=${encodeURIComponent(menu.agent.id)}`)}
          onBenchmark={() => router.push(`/evals?agent=${encodeURIComponent(menu.agent.id)}`)}
          onExport={() => exportJson(menu.agent.id)}
          onDelete={() => (confirming === menu.agent.id ? remove(menu.agent.id) : setConfirming(menu.agent.id))}
        />
      )}
    </div>
  );
}

/* ═══════════════════ The menu ═══════════════════ */

function ContextMenu({
  at,
  confirming,
  onClose,
  onOpen,
  onRun,
  onBenchmark,
  onExport,
  onDelete,
}: {
  at: MenuAt;
  confirming: boolean;
  onClose: () => void;
  onOpen: () => void;
  onRun: () => void;
  onBenchmark: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const Item = ({
    icon,
    label,
    hint,
    tone,
    onClick,
  }: {
    icon: string;
    label: string;
    hint?: string;
    tone?: "err";
    onClick: () => void;
  }) => (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`focusable flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors ${
        tone === "err" ? "text-err hover:bg-raise" : "text-mist hover:bg-raise hover:text-fg"
      }`}
    >
      <Icon name={icon} size={13} className={tone === "err" ? "" : "text-faint"} />
      <span className="flex min-w-0 flex-col">
        <span className="text-[12.5px] font-medium">{label}</span>
        {hint && <span className="text-[10px] leading-tight text-faint">{hint}</span>}
      </span>
    </button>
  );

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: "fixed", left: at.x, top: at.y }}
      className="af-pop z-50 flex w-[236px] flex-col gap-0.5 rounded-lg border border-line bg-surface p-1.5 elev-3"
    >
      <div className="truncate px-2 pt-1 pb-1.5">
        <Label>{at.agent.name}</Label>
      </div>
      <Item icon="bot" label="Open in Builder" hint="The graph, rebuilt from its cards" onClick={onOpen} />
      <Item icon="pulse" label="Run" hint="Straight into the theater" onClick={onRun} />
      <Item icon="chip" label="Benchmark" hint="Upload and run an eval set against it" onClick={onBenchmark} />
      <Item icon="json" label="Export JSON" hint="The spec document itself" onClick={onExport} />
      <div className="my-0.5 h-px bg-line" />
      <Item
        icon="cross"
        label={confirming ? "Click again to delete" : "Delete"}
        hint={confirming ? "Workflows that chain this will break" : undefined}
        tone="err"
        onClick={onDelete}
      />
    </div>
  );
}
