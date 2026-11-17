"use client";

import { Fragment, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { agentHref } from "@/lib/agent-link";
import { api, errorText, type Schemas } from "@/lib/api/client";
import { agentDocument, listAgents, listRuns, retireAgent, type AgentSummary } from "@/lib/api/l2";
import { CLASS_LABEL, listApplications, type Application, type ApplicationClass } from "@/lib/api/l4";
import { getFleet, type PauseInfo } from "@/lib/api/l5";
import { retiredOf, type Retired } from "@/lib/api/l8";
import { pausedLine, retiredLine } from "@/lib/lifecycle";
import { productionRuns } from "@/lib/production";
import { QUIET } from "@/lib/quiet";
import { HARNESS } from "@/lib/spec";
import { useSession } from "@/lib/use-session";
import { usePageFacts } from "./assistant";
import { Icon } from "./builder/icons";
import { DrillModal } from "./drill";
import { Chips, FilterBar, SearchBox, type Chip } from "./filters";
import { Dialog, QuietNote } from "./overlays";
import { GroupHeader } from "./page-tabs";
import { Button, IconButton, Label, RUN_STATE, Status, Tag, type Tone } from "./ui";
import { VersionHistory } from "./versions";

/**
 * Every agent, once.
 *
 * This is the one list of the registry. It replaced two pages that read the
 * same agents through two doors: the saved specifications with their versions
 * and last run (`GET /api/agents`, `GET /api/runs`), and the steps inside each
 * with their purpose, tools, derived autonomy and activity (`GET /api/roster`).
 * A row is an agent; opening the row shows its steps. Kind, owner and a block
 * come from the applications register (`GET /api/applications`), a pause or a
 * drain from the fleet door (`GET /api/fleet`). Where the register names no
 * owner, the owner the agent's own document declares (`metadata.owner`, the
 * one its Configuration tab shows) is read, a few documents at a time.
 *
 * The agents door is the list: when it does not answer, the page says so and
 * shows nothing else. The other four only add to a row, so a door that did
 * not answer leaves its part of the row out and the page says once that
 * something is not connected; no figure is shown in its place.
 *
 * Every action the two pages offered is on the row or behind its menu (also
 * on right-click): open, run, evaluate, versions and deployment, compare
 * versions, drift, dependencies, export, delete. Deleting removes the
 * registry row; retiring (on the agent's Versions tab) keeps every record
 * and refuses new work.
 */

type Roster = Schemas["Roster"];
type RosterGroup = Schemas["RosterGroup"];
type RosterStep = Schemas["RosterAgent"];

/** A read that is still out (`undefined`), did not answer (`null`), or answered. */
type Read<T> = T | null | undefined;

interface LastRun {
  state: string;
  at: string;
}

type StateId = "retired" | "paused" | "blocked" | "deployed" | "not_deployed";

const STATE: Record<StateId, { label: string; tone: Tone }> = {
  deployed: { label: "Deployed", tone: "ok" },
  not_deployed: { label: "Not deployed", tone: "neutral" },
  paused: { label: "Paused", tone: "warn" },
  blocked: { label: "Blocked", tone: "err" },
  retired: { label: "Retired", tone: "neutral" },
};
const STATE_ORDER: StateId[] = ["deployed", "not_deployed", "paused", "blocked", "retired"];

const KIND_TONE: Record<ApplicationClass, Tone> = { chatbot: "queue", rag: "ok", agent: "run", multi_agent: "warn" };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** One agent as the list shows it: the registry's row with what the other doors add. */
interface Row {
  a: AgentSummary;
  retired: Retired | null;
  paused: PauseInfo | null;
  app: Application | null;
  /** The register's owner, else the one the agent's document declares; "" for none, undefined while neither has answered. */
  owner: string | undefined;
  state: StateId;
  /** A save newer than what production runs. */
  draft: number | null;
  last: LastRun | null;
  steps: RosterGroup | null;
}

function stateOf(a: AgentSummary, retired: Retired | null, paused: PauseInfo | null, app: Application | null): StateId {
  if (retired) return "retired";
  if (paused) return "paused";
  if (app?.blocked) return "blocked";
  return typeof a.deployed_version === "number" ? "deployed" : "not_deployed";
}

/* ═══════════════════ the steps inside an agent ═══════════════════ */

/** How far a step may act, derived from its tools' risk and its gates; the reasoning is printed, never only a tooltip. */
function Autonomy({ a }: { a: RosterStep["autonomy"] }) {
  return (
    <span title={a.detail} className="inline-flex w-[168px] flex-col gap-0.5 rounded-md border border-line bg-raise px-2 py-1">
      <span className="flex items-center gap-1.5">
        <span className="flex items-end gap-[2px]" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`w-[2.5px] rounded-[1px] ${i < a.bars ? "bg-fg" : "bg-line-strong"}`} style={{ height: 9 }} />
          ))}
        </span>
        <span className="text-[11.5px] font-semibold whitespace-nowrap text-fg">{a.level}</span>
      </span>
      <span className="line-clamp-2 text-[9.5px] leading-[1.3] text-faint">{a.detail}</span>
    </span>
  );
}

function Position({ h, harness }: { h: RosterStep["hierarchy"]; harness: string }) {
  const meta = HARNESS[harness as keyof typeof HARNESS];
  const stage = h.stage ?? null;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[12px] whitespace-nowrap text-fg">{stage === null ? "Not reached" : stage === 0 ? "Entry" : `Stage ${stage + 1} of ${h.of}`}</span>
      <span className="text-[10.5px] whitespace-nowrap text-faint">
        {meta?.name ?? harness}
        {h.fanout ? " · once per item" : ""}
        {h.maxSteps ? ` · at most ${h.maxSteps} steps` : ""}
      </span>
    </span>
  );
}

function Steps({ group }: { group: RosterGroup }) {
  if (!group.agents.length) return <p className="text-[12px] text-faint">This agent has no steps.</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <table className="w-full min-w-[900px] border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b border-line text-left text-[10.5px] text-faint">
            <th className="px-4 py-2 font-medium">Step</th>
            <th className="w-[46%] px-3 py-2 font-medium">Purpose and tools</th>
            <th className="px-3 py-2 font-medium">Autonomy</th>
            <th className="px-3 py-2 font-medium">Position</th>
            <th className="px-3 py-2 font-medium">Last run</th>
            <th className="px-3 py-2 font-medium">Approvals</th>
          </tr>
        </thead>
        <tbody>
          {group.agents.map((s) => (
            <tr key={s.node} className="border-b border-line align-top last:border-0">
              <td className="min-w-[150px] px-4 py-2.5">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[12px] font-semibold text-fg">{s.label}</span>
                  <span className="font-mono text-[10.5px] text-faint">{s.node}</span>
                </span>
              </td>
              <td className="px-3 py-2.5">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-[12px] leading-[1.5] text-mist">{s.purpose}</span>
                  {s.tools.length > 0 && <span className="font-mono text-[10px] leading-[1.5] break-words text-faint">{s.tools.join(" · ")}</span>}
                </span>
              </td>
              <td className="px-3 py-2.5">
                <Autonomy a={s.autonomy} />
              </td>
              <td className="px-3 py-2.5">
                <Position h={s.hierarchy} harness={s.harness} />
              </td>
              <td className="px-3 py-2.5">
                <span className="flex flex-col gap-0.5 whitespace-nowrap">
                  <span className="tnum text-dim">{s.lastRun ? ago(s.lastRun) : "Never run"}</span>
                  <span className="tnum text-[10.5px] text-faint">{plural(s.runs7d, "run")} in 7 days</span>
                </span>
              </td>
              <td className="px-3 py-2.5">
                {s.pending > 0 ? (
                  <Link href="/runs" title="Open runs" className="focusable rounded-sm hover:underline">
                    <Status tone="warn">{s.pending} awaiting approval</Status>
                  </Link>
                ) : (
                  <span className="whitespace-nowrap text-faint">None waiting</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════ the row's menu ═══════════════════ */

interface MenuAt {
  row: Row;
  x: number;
  y: number;
}

function MenuItem({ icon, label, hint, tone, disabled = false, href, onClick }: { icon: string; label: string; hint?: string; tone?: "err"; disabled?: boolean; href?: string; onClick?: () => void }) {
  const look = `focusable flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors ${tone === "err" ? "text-err hover:bg-raise" : "text-mist hover:bg-raise hover:text-fg"}`;
  const body = (
    <>
      <Icon name={icon} size={13} className={tone === "err" ? "" : "text-faint"} />
      <span className="flex min-w-0 flex-col">
        <span className="text-[12.5px] font-medium">{label}</span>
        {hint && <span className="text-[10px] leading-tight text-faint">{hint}</span>}
      </span>
    </>
  );
  if (href && !disabled) {
    return (
      <Link role="menuitem" href={href} onClick={onClick} className={look}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={`${look} disabled:pointer-events-none disabled:opacity-40`}>
      {body}
    </button>
  );
}

function RowMenu({ at, canDelete, onClose, onExport, onCompare, onDelete }: { at: MenuAt; canDelete: boolean; onClose: () => void; onExport: () => void; onCompare: () => void; onDelete: () => void }) {
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

  // Opened near the foot of the window, the menu moves up until all of it shows.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.style.top = `${Math.max(8, Math.min(at.y, window.innerHeight - el.offsetHeight - 8))}px`;
  }, [at.y]);

  const { a, retired } = at.row;
  const enc = encodeURIComponent(a.id);
  return (
    <div ref={ref} role="menu" style={{ position: "fixed", left: at.x, top: at.y }} className="af-pop z-50 flex max-h-[calc(100vh-16px)] w-[264px] flex-col gap-0.5 overflow-y-auto rounded-lg border border-line bg-surface p-1.5 elev-3">
      <div className="truncate px-2 pt-1 pb-1.5">
        <Label>{a.name}</Label>
      </div>
      <MenuItem icon="bot" label="Open" hint="Configuration, versions, bill of materials" href={agentHref(a.id)} onClick={onClose} />
      <MenuItem icon="pulse" label="Run" hint={retired ? "Retired: it takes no new runs" : "Opens Runs with this agent chosen"} disabled={Boolean(retired)} href={`/runs?agent=${enc}`} onClick={onClose} />
      <MenuItem icon="chip" label="Evaluate" hint="Build or run a benchmark against it" href={`/evals?agent=${enc}`} onClick={onClose} />
      <MenuItem icon="gavel" label="Versions and deployment" hint="Reviews, deploy gate, rollback, retirement" href={`/lifecycle?agent=${enc}`} onClick={onClose} />
      <MenuItem icon="clock" label="Compare versions" hint="What changed between two saves" onClick={onCompare} />
      <MenuItem icon="layers" label="Bill of materials" hint="Its models, tools, servers and peers" href={`/bom?agent=${enc}`} onClick={onClose} />
      <MenuItem icon="refresh" label="Drift" hint="Its last day against the month before" href={`/drift?agent=${enc}`} onClick={onClose} />
      <MenuItem icon="plug" label="Dependencies" hint="What it relies on, and what relies on it" href={`/dependencies?node=${encodeURIComponent(`agent:${a.id}`)}`} onClick={onClose} />
      <MenuItem icon="json" label="Export JSON" hint="The agent's document itself" onClick={onExport} />
      <div className="my-0.5 h-px bg-line" />
      <MenuItem icon="cross" label="Delete" hint={canDelete ? "Removes it from the registry" : 'Needs the "deploy" permission'} tone="err" disabled={!canDelete} onClick={onDelete} />
    </div>
  );
}

/* ═══════════════════ the page ═══════════════════ */

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function AgentsPage() {
  const params = useSearchParams();
  const { can, loaded } = useSession();
  const canDelete = !loaded || can("deploy");

  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<Read<Record<string, LastRun>>>(undefined);
  const [roster, setRoster] = useState<Read<Record<string, RosterGroup>>>(undefined);
  const [apps, setApps] = useState<Read<Record<string, Application>>>(undefined);
  const [fleet, setFleet] = useState<Read<Record<string, PauseInfo>>>(undefined);
  /** The owner each agent's document declares: "" for none, null when the document could not be read; an agent is absent until its read settles. */
  const [declared, setDeclared] = useState<Record<string, string | null>>({});
  /** Why a door that only adds to a row did not answer; printed when the console is not quiet. */
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const [q, setQ] = useState(params.get("q") ?? "");
  const [state, setState] = useState<StateId | "">("");
  const [kind, setKind] = useState<ApplicationClass | "">("");
  /** `?id=` (the address the old list was linked with) opens that agent's row. */
  const [open, setOpen] = useState<Record<string, boolean>>(() => (params.get("id") ? { [params.get("id") as string]: true } : {}));
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [compare, setCompare] = useState<AgentSummary | null>(null);
  const [deleting, setDeleting] = useState<AgentSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    listAgents()
      .then((rows) => {
        setAgents(rows);
        setError("");
      })
      .catch((e: Error) => {
        setAgents((prev) => prev ?? []);
        setError(e.message || "the agents door did not answer");
      });
  }, []);

  useEffect(() => {
    let live = true;
    const down = (door: string) => (e: unknown) => {
      if (live) setReasons((r) => ({ ...r, [door]: (e as Error)?.message || "it did not answer" }));
    };
    refresh();
    // An agent's last run is production's: a canary's shadow run is a mirror, never the agent's own (lib/production.ts).
    listRuns()
      .then((rows) => {
        if (!live) return;
        const out: Record<string, LastRun> = {};
        for (const r of productionRuns(rows)) if (!out[r.system] || r.at > out[r.system].at) out[r.system] = { state: r.state, at: r.at };
        setRuns(out);
      })
      .catch((e) => {
        if (live) setRuns(null);
        down("runs")(e);
      });
    api
      .GET("/api/roster")
      .then(({ data, error: err, response }) => {
        if (!live) return;
        const d: Roster | undefined = data;
        if (!d || !Array.isArray(d.groups)) {
          setRoster(null);
          return down("steps")(new Error(errorText(err, response)));
        }
        setRoster(Object.fromEntries(d.groups.map((g) => [g.id, g])));
      })
      .catch((e) => {
        if (live) setRoster(null);
        down("steps")(e);
      });
    listApplications()
      .then((rows) => live && setApps(Object.fromEntries(rows.map((r) => [r.id, r]))))
      .catch((e) => {
        if (live) setApps(null);
        down("kind and owner")(e);
      });
    getFleet()
      .then((f) => live && setFleet(f.paused))
      .catch((e) => {
        if (live) setFleet(null);
        down("pauses")(e);
      });
    return () => {
      live = false;
    };
  }, [refresh]);

  // The owner in each agent's own document, four reads at a time, so a long registry does not open every connection at once.
  useEffect(() => {
    if (!agents?.length) return;
    let live = true;
    const queue = agents.map((a) => a.id);
    const worker = async () => {
      while (live && queue.length) {
        const id = queue.shift() as string;
        const doc = await agentDocument(id).catch(() => null);
        const meta = doc && typeof doc.metadata === "object" && doc.metadata ? (doc.metadata as Record<string, unknown>) : null;
        if (live) setDeclared((d) => ({ ...d, [id]: doc ? (typeof meta?.owner === "string" ? meta.owner : "") : null }));
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    return () => {
      live = false;
    };
  }, [agents]);

  const rows: Row[] = useMemo(
    () =>
      (agents ?? []).map((a) => {
        const retired = retiredOf(a.retired);
        const paused = fleet?.[a.id] ?? null;
        const app = apps?.[a.id] ?? null;
        const steps = roster?.[a.id] ?? null;
        const running = typeof a.deployed_version === "number" ? a.deployed_version : null;
        const draft = !retired && running !== null && typeof a.version === "number" && a.version !== running ? a.version : null;
        // The run ledger says how the last run ended; the roster knows only when it was.
        const last = runs?.[a.id] ?? (steps?.lastRun ? { state: "", at: steps.lastRun } : null);
        // Blank while either read is out; "unassigned" only when the register or the document answered and named nobody.
        const doc = declared[a.id];
        const owner = app?.owner || doc || (apps === undefined || doc === undefined ? undefined : app || doc === "" ? "" : undefined);
        return { a, retired, paused, app, owner, state: stateOf(a, retired, paused, app), draft, last, steps };
      }),
    [agents, apps, declared, fleet, roster, runs],
  );

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (state && r.state !== state) return false;
      if (kind && r.app?.class !== kind) return false;
      if (!term) return true;
      const hay = [r.a.name, r.a.id, r.a.description, r.owner ?? "", ...(r.steps?.agents.flatMap((s) => [s.label, s.node]) ?? [])];
      return hay.some((x) => x.toLowerCase().includes(term));
    });
  }, [rows, q, state, kind]);

  // A quiet console (lib/quiet.ts): the list could not be read, so the page says it is not connected and lists nothing.
  const unread = Boolean(error) && (agents?.length ?? 0) === 0;
  const activity = runs !== null || roster !== null;
  const partDown = [runs, roster, apps, fleet].some((x) => x === null);
  const stateChips: Chip[] = STATE_ORDER.map((id) => ({ id, n: rows.filter((r) => r.state === id).length }))
    .filter((x) => x.n > 0 || x.id === "deployed" || x.id === "not_deployed" || x.id === state)
    .map((x) => ({ value: x.id, label: STATE[x.id].label, count: x.n, active: state === x.id }));
  const kinds = [...new Set(rows.map((r) => r.app?.class).filter((c): c is ApplicationClass => Boolean(c)))];
  const kindChips: Chip[] = kinds.map((c) => ({ value: c, label: CLASS_LABEL[c], count: rows.filter((r) => r.app?.class === c).length, active: kind === c }));
  const filters = (state ? 1 : 0) + (kind ? 1 : 0) + (q.trim() ? 1 : 0);
  // The owner column stays while either door that names one may still answer.
  const owners = apps !== null || rows.some((r) => r.owner);
  const cols = 5 + (owners ? 1 : 0) + (activity ? 1 : 0);

  usePageFacts({
    agents: unread ? "not connected" : agents ? agents.length : "loading",
    byState: agents && !unread ? Object.fromEntries(STATE_ORDER.map((id) => [id, rows.filter((r) => r.state === id).length])) : null,
    awaitingApproval: rows.reduce((n, r) => n + (r.steps?.pending ?? 0), 0),
    filter: state || kind || null,
  });

  const openMenu = useCallback((row: Row, x: number, y: number) => {
    const pad = 8;
    setMenu({ row, x: Math.max(pad, Math.min(x, window.innerWidth - 264 - pad)), y: Math.max(pad, y) });
  }, []);

  const exportJson = async (id: string) => {
    setMenu(null);
    const spec = await agentDocument(id).catch(() => null);
    if (!spec) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const remove = async (id: string) => {
    setBusy(true);
    // A refusal is said by the console's guard (401, 403); the list is read again either way.
    await retireAgent(id).catch(() => {});
    setBusy(false);
    setDeleting(null);
    refresh();
  };

  return (
    <div className="min-h-full" data-hue="blue">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7">
        <GroupHeader group="agents" tab="agents">
          Every agent saved on this deployment: what it does, who owns it, whether production runs it and when it last ran. Open an agent for its configuration, versions and bill of materials, or open its row for the steps inside it.
        </GroupHeader>

        {unread && (QUIET ? <QuietNote /> : <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">{error}</p>)}

        {agents === null && !error && <p className="text-[12px] text-faint">Reading the agents&hellip;</p>}

        {agents?.length === 0 && !error && (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line-strong bg-surface px-6 py-10">
            <p className="text-[14px] font-medium text-fg">No agent is on this deployment yet.</p>
            <p className="max-w-[60ch] text-[12.5px] leading-relaxed text-faint">Agents are delivered to this console rather than designed in it. Once one is saved it is listed here, ready to configure, run and deploy.</p>
          </div>
        )}

        {(agents?.length ?? 0) > 0 && (
          <>
            <FilterBar
              count={filters}
              onClear={() => {
                setState("");
                setKind("");
                setQ("");
              }}
            >
              <Chips label="State" items={stateChips} onToggle={(v) => setState(state === v ? "" : (v as StateId))} />
              {kindChips.length > 1 && <Chips label="Kind" items={kindChips} onToggle={(v) => setKind(kind === v ? "" : (v as ApplicationClass))} />}
            </FilterBar>

            <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
              <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-raise/55 px-4 py-2.5">
                <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Agents</span>
                <span className="tnum text-[11px] text-faint">
                  {shown.length} of {rows.length}
                </span>
                {error && (QUIET ? <QuietNote inline /> : <span className="text-[11px] text-err">{error}</span>)}
                {!error && partDown && (QUIET ? <QuietNote inline /> : <span className="text-[11px] text-err">Not read: {Object.entries(reasons).map(([door, why]) => `${door} (${why})`).join("; ")}</span>)}
                <span className="grow" />
                <SearchBox value={q} onChange={setQ} placeholder="Name, id, owner or step" width="w-[240px]" />
              </div>
              {/* Positioned, so the visually hidden column names stay inside the scrolling area and never widen the page. */}
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[920px] border-collapse text-[11.5px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[10.5px] text-faint">
                      <th className="w-9 py-2 pl-3 font-medium">
                        <span className="sr-only">Steps</span>
                      </th>
                      <th className="w-[38%] px-2 py-2 font-medium">Agent</th>
                      <th className="px-3 py-2 font-medium">Kind</th>
                      {owners && <th className="px-3 py-2 font-medium">Owner</th>}
                      <th className="px-3 py-2 font-medium whitespace-nowrap">State and version</th>
                      {activity && <th className="px-3 py-2 font-medium">Last run</th>}
                      <th className="px-3 py-2 font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const { a, retired, paused, app, steps, last } = r;
                      const isOpen = Boolean(open[a.id]);
                      const st = STATE[r.state];
                      const ran = last?.state ? (RUN_STATE[last.state] ?? { tone: "neutral" as const, label: last.state }) : null;
                      const stateLine = retired
                        ? [retired.reason, retired.replacement ? `replaced by ${retired.replacement}` : ""].filter(Boolean).join(" · ")
                        : paused
                          ? paused.reason
                          : r.state === "blocked"
                            ? "every door refuses it"
                            : "";
                      return (
                        <Fragment key={a.id}>
                          <tr
                            className={`border-b border-line align-top transition-colors hover:bg-raise/50 ${isOpen ? "bg-raise/40" : ""} ${menu?.row.a.id === a.id ? "bg-raise/60" : ""}`}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              openMenu(r, e.clientX, e.clientY);
                            }}
                          >
                            <td className="py-2 pl-3">
                              <button
                                type="button"
                                aria-expanded={isOpen}
                                aria-label={`${isOpen ? "Hide" : "Show"} the steps of ${a.name}`}
                                title={isOpen ? "Hide its steps" : "Show its steps"}
                                onClick={() => setOpen((o) => ({ ...o, [a.id]: !o[a.id] }))}
                                className="focusable grid size-6 cursor-pointer place-items-center rounded-sm bg-raise text-dim hover:text-fg"
                              >
                                <Chevron open={isOpen} />
                              </button>
                            </td>
                            <td className="min-w-[230px] px-2 py-2">
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <Link href={agentHref(a.id)} className="focusable w-fit rounded-sm text-[12.5px] font-semibold text-fg hover:underline">
                                  {a.name}
                                </Link>
                                <span className="font-mono text-[10.5px] text-faint">{a.id}</span>
                                {a.description && !isOpen && (
                                  <span className="mt-0.5 line-clamp-2 max-w-[78ch] text-[11.5px] leading-[1.5] text-dim" title={a.description}>
                                    {a.description}
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className="flex flex-col items-start gap-1">
                                {app && <Tag tone={KIND_TONE[app.class]}>{CLASS_LABEL[app.class]}</Tag>}
                                <span className="tnum text-[10.5px] whitespace-nowrap text-faint">
                                  {plural(a.nodes, "step")} · starts by {a.trigger}
                                </span>
                              </span>
                            </td>
                            {owners && <td className="max-w-[200px] px-3 py-2 break-words text-dim">{r.owner === undefined ? "" : r.owner || <span className="text-faint">Unassigned</span>}</td>}
                            <td className="max-w-[240px] min-w-[150px] px-3 py-2">
                              <span className="flex flex-col gap-0.5">
                                <span title={retired ? retiredLine(retired) : paused ? pausedLine(a.name, paused) : undefined}>
                                  <Status tone={st.tone}>{paused?.mode === "drain" ? "Draining" : st.label}</Status>
                                </span>
                                <span className="tnum text-[10.5px] leading-[1.4] text-faint">
                                  {typeof a.deployed_version === "number"
                                    ? `Production runs version ${a.deployed_version}`
                                    : typeof a.version === "number"
                                      ? `Latest save is version ${a.version}`
                                      : "No version on record"}
                                </span>
                                {r.draft !== null && <span className="tnum text-[10.5px] leading-[1.4] text-warn">Draft version {r.draft} saved since</span>}
                                {stateLine && <span className="line-clamp-2 text-[10.5px] leading-[1.4] text-faint">{stateLine}</span>}
                              </span>
                            </td>
                            {activity && (
                              <td className="px-3 py-2">
                                <span className="flex flex-col items-start gap-0.5 whitespace-nowrap">
                                  {ran ? <Status tone={ran.tone}>{ran.label}</Status> : !last && runs !== undefined && roster !== undefined ? <span className="text-faint">Never run</span> : null}
                                  {(last || steps) && (
                                    <span className="tnum text-[10.5px] text-faint">{[last ? ago(last.at) : "", steps ? `${plural(steps.runs7d, "run")} in 7 days` : ""].filter(Boolean).join(" · ")}</span>
                                  )}
                                  {steps && steps.pending > 0 && (
                                    <Link href="/approvals" className="focusable rounded-sm hover:underline">
                                      <Status tone="warn">{steps.pending} awaiting approval</Status>
                                    </Link>
                                  )}
                                </span>
                              </td>
                            )}
                            <td className="py-2 pr-3 pl-3">
                              <span className="flex items-center justify-end gap-1.5">
                                <Button size="sm" variant="solid" tone="neutral" href={agentHref(a.id)}>
                                  Open
                                </Button>
                                <Button size="sm" variant="solid" tone="ink" href={`/runs?agent=${encodeURIComponent(a.id)}`} permission="run" disabled={Boolean(retired)}>
                                  Run
                                </Button>
                                <IconButton
                                  label={`More actions for ${a.name}`}
                                  size="sm"
                                  onClick={(e) => {
                                    // Anchored to the button itself: keyboard activation reports (0,0).
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    openMenu(r, rect.right - 264, rect.bottom + 4);
                                  }}
                                >
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                    <circle cx="5" cy="12" r="1.8" />
                                    <circle cx="12" cy="12" r="1.8" />
                                    <circle cx="19" cy="12" r="1.8" />
                                  </svg>
                                </IconButton>
                              </span>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="border-b border-line bg-canvas">
                              <td colSpan={cols} className="px-4 py-3 pl-12">
                                <div className="flex flex-col gap-3">
                                  {a.description && <p className="max-w-[110ch] text-[12px] leading-[1.6] text-dim">{a.description}</p>}
                                  {retired && <p className="max-w-[110ch] text-[11.5px] leading-[1.55] text-faint">{retiredLine(retired)}</p>}
                                  {paused && <p className="max-w-[110ch] text-[11.5px] leading-[1.55] text-faint">{pausedLine(a.name, paused)}</p>}
                                  {roster === undefined && <p className="text-[12px] text-faint">Reading its steps&hellip;</p>}
                                  {/* A quiet console has said once, in the bar above, that something is not connected. */}
                                  {roster === null && !QUIET && <p className="text-[11.5px] text-err">Its steps could not be read: {reasons.steps}</p>}
                                  {roster && !steps && <p className="text-[12px] text-faint">The registry lists no steps for this agent.</p>}
                                  {steps && <Steps group={steps} />}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={cols} className="px-4 py-8 text-center text-[11.5px] text-faint">
                          No agent matches.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      {menu && (
        <RowMenu
          at={menu}
          canDelete={canDelete}
          onClose={() => setMenu(null)}
          onExport={() => exportJson(menu.row.a.id)}
          onCompare={() => {
            setCompare(menu.row.a);
            setMenu(null);
          }}
          onDelete={() => {
            setDeleting(menu.row.a);
            setMenu(null);
          }}
        />
      )}

      {compare && (
        <DrillModal
          title={`Versions · ${compare.name}`}
          subtitle="Every save and every deploy is a version: who saved it, when, its digest, and whether it is deployed. Pick two to see what changed."
          onClose={() => setCompare(null)}
          actions={
            <Button size="sm" variant="solid" tone="neutral" href={`/lifecycle?agent=${encodeURIComponent(compare.id)}`}>
              Open its Versions tab
            </Button>
          }
        >
          <VersionHistory agent={compare.id} />
        </DrillModal>
      )}

      {deleting && (
        <Dialog modal tone="err" title={`Delete ${deleting.name}?`} confirm="Delete" cancel="Keep it" loading={busy} onClose={() => !busy && setDeleting(null)} onConfirm={() => remove(deleting.id)}>
          This removes the agent from the registry, and any agent that calls it will stop working. Its versions and past runs stay readable. To stop new work and keep the agent, retire it on its Versions tab instead.
        </Dialog>
      )}
    </div>
  );
}

export function AgentsList() {
  return (
    <Suspense>
      <AgentsPage />
    </Suspense>
  );
}
