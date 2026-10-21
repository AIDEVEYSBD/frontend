"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./builder/icons";
import { IconButton, Label, RUN_STATE, Status } from "./ui";
import { Banner } from "./overlays";
import { DrillModal } from "./drill";
import { VersionHistory } from "./versions";
import { useSession } from "@/lib/use-session";
import { agentDocument, listAgents, listRuns, retireAgent } from "@/lib/api/l2";
import { productionRuns } from "@/lib/production";
import { retiredOf, type Retired } from "@/lib/api/l8";
import { retiredLine } from "@/lib/lifecycle";

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
 *
 * Phase L8: each card says where its agent stands in its lifecycle: the
 * version production runs and a draft saved since, or that it is retired
 * (it takes no new work; its runs and versions stay readable). The menu's
 * Lifecycle opens the spine, reviews, deployments, rollback and retirement.
 * Retiring is not deleting: Delete removes the registry row, Retire (on the
 * lifecycle page) keeps every record and refuses new work.
 */

interface SavedAgent {
  id: string;
  name: string;
  description: string;
  nodes: number;
  /** L8: the latest save, the version production runs, and a retirement. */
  version?: number | null;
  deployed_version?: number | null;
  retired?: unknown;
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
  /* The agent whose versions are open: its history and a diff between any two. */
  const [versionsOf, setVersionsOf] = useState<SavedAgent | null>(null);
  const router = useRouter();
  // Deleting a workflow is a deploy-level change; the menu says so to a viewer.
  const { can, loaded } = useSession();
  const canDelete = !loaded || can("deploy");

  const refresh = useCallback(() => {
    listAgents()
      .then((rows) => setAgents(rows))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    listRuns()
      // An agent's last run is production's: a canary's shadow run is a mirror, never the agent's own (lib/production.ts).
      .then((rows) => setRuns(productionRuns(rows).map((r) => ({ id: r.id, system: r.system, state: r.state, at: r.at }))))
      .catch(() => setRuns([]));
  }, []);

  const openMenu = useCallback((agent: SavedAgent, x: number, y: number) => {
    const pad = 8;
    setConfirming(null);
    setMenu({
      agent,
      x: Math.max(pad, Math.min(x, window.innerWidth - 240 - pad)),
      y: Math.max(pad, Math.min(y, window.innerHeight - 330 - pad)),
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
    // A refusal is said by the console's guard (401, 403); the list is read again either way.
    await retireAgent(id).catch(() => {});
    setMenu(null);
    setConfirming(null);
    refresh();
  };

  const exportJson = async (id: string) => {
    const spec = await agentDocument(id).catch(() => null);
    if (!spec) return;
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMenu(null);
  };

  return (
    <div className="min-h-full" data-hue="blue">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-7 px-5 py-7">
        <header className="flex items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Workflows</h1>
            <p className="max-w-[620px] text-[13.5px] leading-relaxed text-dim">
              Review the governed workflow specifications saved in Agent Factory. Open a workflow
              to examine its design, run it directly or invoke it from another workflow using <code className="font-mono text-[12px]">agent.invoke</code>.
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
            <p className="text-[14px] font-medium text-fg">No workflows have been saved.</p>
            <p className="max-w-[480px] text-[12.5px] leading-relaxed text-faint">
              Create and save a workflow in the builder. It will appear here and become available
              for direct execution or use by other workflows.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(agents ?? []).map((a) => {
            const last = lastRunOf(a.id);
            const state = last ? (RUN_STATE[last.state] ?? { tone: "neutral" as const, label: last.state }) : null;
            const retired: Retired | null = retiredOf(a.retired);
            const running = a.deployed_version ?? null;
            const draft = !retired && running !== null && a.version !== null && a.version !== undefined && a.version !== running ? a.version : null;
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
                  {retired ? (
                    <p className="text-[11px] leading-[1.5] text-faint" title={retiredLine(retired)}>
                      <span className="font-medium text-dim">Retired</span> {retired.reason ? `· ${retired.reason}` : ""}
                      {retired.replacement ? ` · replaced by ${retired.replacement}` : ""}
                    </p>
                  ) : running !== null ? (
                    <p className="font-mono text-[10.5px] text-faint">
                      production runs v{running}
                      {draft !== null && <span className="text-warn"> · draft v{draft} saved since</span>}
                    </p>
                  ) : null}
                  <div className="mt-auto flex items-center gap-2.5 border-t border-line pt-2.5">
                    <span className="tnum font-mono text-[10.5px] text-faint">
                      {a.nodes} node{a.nodes === 1 ? "" : "s"}
                    </span>
                    <span className="grow" />
                    {retired && <Status tone="neutral">Retired</Status>}
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
          onLifecycle={() => router.push(`/lifecycle?agent=${encodeURIComponent(menu.agent.id)}`)}
          onExport={() => exportJson(menu.agent.id)}
          onVersions={() => {
            setVersionsOf(menu.agent);
            setMenu(null);
          }}
          canDelete={canDelete}
          onDelete={() => (confirming === menu.agent.id ? remove(menu.agent.id) : setConfirming(menu.agent.id))}
        />
      )}

      {versionsOf && (
        <DrillModal
          title={`Versions · ${versionsOf.name}`}
          subtitle="Every save and every deploy is a version: who saved it, when, its digest, and whether it is deployed. Pick two to see what changed, in the spec's own terms."
          onClose={() => setVersionsOf(null)}
        >
          <VersionHistory agent={versionsOf.id} />
        </DrillModal>
      )}
    </div>
  );
}

/* ═══════════════════ The menu ═══════════════════ */

/** One row of the card's context menu. Module-level, so it keeps its identity across renders. */
function MenuItem({
  icon,
  label,
  hint,
  tone,
  disabled = false,
  onClick,
}: {
  icon: string;
  label: string;
  hint?: string;
  tone?: "err";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`focusable flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-40 ${
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
}

function ContextMenu({
  at,
  confirming,
  onClose,
  onOpen,
  onRun,
  onBenchmark,
  onLifecycle,
  onExport,
  onVersions,
  canDelete,
  onDelete,
}: {
  at: MenuAt;
  confirming: boolean;
  onClose: () => void;
  onOpen: () => void;
  onRun: () => void;
  onBenchmark: () => void;
  onLifecycle: () => void;
  onExport: () => void;
  onVersions: () => void;
  canDelete: boolean;
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
      <MenuItem icon="bot" label="Open in Builder" hint="The graph, rebuilt from its cards" onClick={onOpen} />
      <MenuItem icon="pulse" label="Run" hint={retiredOf(at.agent.retired) ? "Retired: it takes no new runs" : "Straight into the theater"} disabled={Boolean(retiredOf(at.agent.retired))} onClick={onRun} />
      <MenuItem icon="chip" label="Benchmark" hint="Upload and run an eval set against it" onClick={onBenchmark} />
      <MenuItem icon="gavel" label="Lifecycle" hint="Reviews, the gate, deployments, rollback, retirement" onClick={onLifecycle} />
      <MenuItem icon="json" label="Export JSON" hint="The spec document itself" onClick={onExport} />
      <MenuItem icon="clock" label="Versions" hint="Every save and deploy, and what changed" onClick={onVersions} />
      <div className="my-0.5 h-px bg-line" />
      <MenuItem
        icon="cross"
        label={confirming ? "Click again to delete" : "Delete"}
        hint={!canDelete ? 'Needs the "deploy" permission' : confirming ? "Workflows that chain this will break" : undefined}
        tone="err"
        disabled={!canDelete}
        onClick={onDelete}
      />
    </div>
  );
}
