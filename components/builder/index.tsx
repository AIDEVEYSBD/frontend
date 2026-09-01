"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button } from "../ui";
import { Canvas, NODE_H, NODE_W, type CanvasApi } from "./canvas";
import { Inspector } from "./inspector";
import { Palette } from "./palette";
import { AuthorPanel } from "./author-panel";
import { DeployTheater } from "./deploy-theater";
import { EMPTY, reduce, withHistory, type HistoryAction } from "@/lib/builder-store";
import { fromDocument, toDocument, validate, type HarnessKind, type Problem } from "@/lib/spec";

type View = "canvas" | "agent";

const historyReduce = withHistory(reduce);

/** The localStorage slot the debounced autosave writes to. */
const DRAFT_SLOT = "af-builder-draft";

export function Builder() {
  const [state, rawDispatch] = useReducer(historyReduce, { past: [], present: EMPTY, future: [] });
  const system = state.present;
  const params = useSearchParams();
  const router = useRouter();
  const loadId = params.get("load");
  const draftId = params.get("draftId");
  const autoRun = params.get("run") === "1";
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("canvas");
  const [showProblems, setShowProblems] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [saving, setSaving] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const [refreshTick, setRefreshTick] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [restored, setRestored] = useState(false);
  const [problemsFlash, setProblemsFlash] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef(0);
  const canvasApi = useRef<CanvasApi | null>(null);

  /* Every edit marks the document dirty; Save and Deploy clear the mark. */
  const dispatch = useCallback((a: HistoryAction) => {
    rawDispatch(a);
    setDirty(true);
  }, []);

  const clearDraftSlot = () => {
    try {
      localStorage.removeItem(DRAFT_SLOT);
    } catch {
      /* fine */
    }
  };

  /* Arriving via /workflows → Open in Builder: fetch the saved document and
     reconstruct it. The document is the only artefact — the same nodes and
     cards come back because both directions read the same shape. */
  useEffect(() => {
    if (!loadId && !draftId) return;
    let stop = false;
    const url = draftId
      ? `/api/drafts?id=${encodeURIComponent(draftId)}`
      : `/api/agents?id=${encodeURIComponent(loadId!)}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (stop) return;
        if (d.error) throw new Error(String(d.error));
        // A fetched document is saved work — loading it is not an edit.
        rawDispatch({ type: "load", system: fromDocument(d.spec) });
        if (autoRun && loadId) router.push(`/runs?agent=${encodeURIComponent(loadId)}`);
      })
      .catch((e) =>
        !stop && setLoadError(`Could not load "${draftId ?? loadId}" — ${(e as Error).message}`),
      );
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadId, draftId, autoRun]);

  /* Arriving cold: whatever the last session left in the draft slot comes
     back, flagged so it can be discarded in one click. */
  useEffect(() => {
    if (loadId || draftId) return;
    try {
      const raw = localStorage.getItem(DRAFT_SLOT);
      if (!raw || raw === JSON.stringify(toDocument(EMPTY))) return;
      // localStorage is unreadable during SSR render, so the restore has to
      // happen in an effect even though it sets state synchronously.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      dispatch({ type: "load", system: fromDocument(JSON.parse(raw)) });
      setRestored(true);
    } catch {
      /* unreadable draft — start empty */
    }
    // Mount-time restore only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Debounced autosave. Only non-empty systems are worth keeping — an empty
     canvas overwriting a real draft would defeat the whole point. */
  useEffect(() => {
    if (!system.nodes.length) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_SLOT, JSON.stringify(toDocument(system)));
      } catch {
        /* storage unavailable — autosave is best-effort */
      }
    }, 2000);
    return () => clearTimeout(id);
  }, [system]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older engines only honor returnValue.
      e.returnValue = true;
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  /* Narrow windows start with both rails closed, and closing follows a shrink
     across the threshold — but an explicit toggle is never fought after that. */
  useEffect(() => {
    let prev = window.innerWidth;
    const close = () => {
      setLeftOpen(false);
      setRightOpen(false);
    };
    if (prev < 1280) close();
    const onResize = () => {
      const w = window.innerWidth;
      if (w < 1280 && prev >= 1280) close();
      prev = w;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* Selecting something with the inspector rail closed opens it — a selection
     whose details are invisible reads as a click that did nothing. */
  const select = useCallback((id: string | null) => {
    setSelected(id);
    if (id) setRightOpen(true);
  }, []);

  const problems = useMemo(() => validate(system), [system]);
  const errors = problems.filter((p) => p.severity === "error");

  /* A new node lands to the right of the rightmost one, on the same row —
     which is where the eye already is, and avoids stacking on the origin. */
  const addNode = useCallback(
    (harness: HarnessKind) => {
      const right = system.nodes.reduce((m, n) => Math.max(m, n.x), 0);
      const y = system.nodes.length ? system.nodes[system.nodes.length - 1].y : 200;
      dispatch({ type: "add-node", harness, x: right + NODE_W + 52, y });
    },
    [system.nodes, dispatch],
  );

  /* A drop knows where it landed; a click does not. */
  const addNodeAt = useCallback(
    (harness: string, x: number, y: number) => {
      dispatch({ type: "add-node", harness: harness as HarnessKind, x, y });
    },
    [dispatch],
  );

  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2500);
  }, []);

  /* Click-to-grant: a palette click carries the same payload its drag would,
     targeted at the selected node instead of the drop point. */
  const onGrant = useCallback(
    (kind: "tool" | "connector" | "system" | "harness" | "workflow", payload: string) => {
      if (kind === "harness") return; // the palette's onAdd already handles it
      if (kind === "workflow") {
        try {
          const w = JSON.parse(payload) as { id: string; name: string };
          const right = system.nodes.reduce((m, n) => Math.max(m, n.x), 0);
          const y = system.nodes.length ? system.nodes[system.nodes.length - 1].y : 200;
          dispatch({ type: "add-workflow-node", agent: w.id, name: w.name, x: right + NODE_W + 52, y });
        } catch {
          /* malformed payload — ignore */
        }
        return;
      }
      if (kind === "system") {
        if (payload === "input") {
          if (!system.trigger || system.trigger.kind === "api") {
            dispatch({ type: "set-trigger", trigger: { kind: "prompt", config: {} } });
          }
          select("sys:trigger");
        } else {
          dispatch({ type: "set-outputs", outputs: [...(system.outputs ?? []), { kind: "response" }] });
          select(`sys:out:${(system.outputs ?? []).length}`);
        }
        return;
      }
      const node = selected && system.nodes.some((n) => n.id === selected) ? selected : null;
      if (!node) {
        flashNotice("Select an agent on the canvas first");
        return;
      }
      if (kind === "tool") {
        dispatch({ type: "grant-tool-card", node, card: payload });
      } else {
        try {
          const c = JSON.parse(payload) as { tool: string; kind: string };
          dispatch({ type: "add-connection", tool: c.tool, kind: c.kind, node });
        } catch {
          /* malformed payload — ignore */
        }
      }
    },
    [system, selected, dispatch, flashNotice, select],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative z-10 flex h-11 shrink-0 items-center gap-3 border-b border-line bg-canvas px-3">
        <div className="relative flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-bold text-on-grain">{system.name}</span>
          <span className="hidden shrink-0 font-mono text-[10.5px] text-dim sm:inline">{system.id}</span>
        </div>

        <div className="relative flex shrink-0 items-center gap-1 rounded-md border border-line bg-raise p-px">
          {([
            { id: "canvas", label: "Canvas" },
            { id: "agent", label: "Agent builder" },
          ] as { id: View; label: string }[]).map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              aria-pressed={view === v.id}
              className={`focusable cursor-pointer rounded-sm px-2.5 py-1 text-[12px] transition-colors ${
                view === v.id
                  ? "bg-surface font-semibold text-fg shadow-[var(--shadow-1)]"
                  : "font-medium text-faint hover:text-dim"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <span className="grow" />

        <div className="relative flex shrink-0 items-center gap-2">
          {system.nodes.length > 0 && (
            <Button
              size="sm"
              variant="quiet"
              tone={confirmClear ? "err" : "neutral"}
              onClick={() => {
                // One click asks; the second, within three seconds, clears.
                // A stray click must never erase a built graph.
                if (!confirmClear) {
                  setConfirmClear(true);
                  setTimeout(() => setConfirmClear(false), 3000);
                  return;
                }
                dispatch({ type: "load", system: EMPTY });
                setSelected(null);
                setConfirmClear(false);
              }}
            >
              {confirmClear ? "Really clear?" : "Clear"}
            </Button>
          )}

          <span title={dirty && saving === "idle" ? "Unsaved changes" : undefined}>
            <Button
              size="sm"
              variant="quiet"
              onClick={async () => {
                setSaving("busy");
                try {
                  const res = await fetch("/api/agents", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ spec: toDocument(system) }),
                  });
                  setSaving(res.ok ? "done" : "failed");
                  if (res.ok) {
                    setRefreshTick((n) => n + 1);
                    setDirty(false);
                    clearDraftSlot();
                  }
                } catch {
                  setSaving("failed");
                }
                setTimeout(() => setSaving("idle"), 1400);
              }}
              disabled={system.nodes.length === 0 || saving === "busy"}
            >
              {saving === "done"
                ? "Saved"
                : saving === "failed"
                  ? "Save failed"
                  : dirty
                    ? "Save*"
                    : "Save"}
            </Button>
          </span>

          <span title={errors.length > 0 ? "Fix the blocking problems first" : undefined}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                // Running always happens in the theater. The canvas hands its
                // document over and the theater is the only place a run lives.
                sessionStorage.setItem("af-run-draft", JSON.stringify(toDocument(system)));
                router.push("/runs?draft=1");
              }}
              disabled={errors.length > 0 || system.nodes.length === 0}
            >
              Run
            </Button>
          </span>

          <Button
            size="sm"
            variant="solid"
            tone="ink"
            disabled={system.nodes.length === 0}
            onClick={() => {
              // With errors present the button leads to them, not to a dead
              // click — the problems rail opens and flashes once.
              if (errors.length) {
                setShowProblems(true);
                setProblemsFlash(true);
                window.setTimeout(() => setProblemsFlash(false), 950);
                return;
              }
              setDeploying(true);
            }}
          >
            {system.nodes.length && errors.length ? `${errors.length} to fix` : "Deploy"}
          </Button>
        </div>
      </header>

      {deploying && (
        <DeployTheater
          doc={toDocument(system)}
          onClose={(deployed, refused) => {
            setDeploying(false);
            if (deployed) {
              setRefreshTick((n) => n + 1);
              setDirty(false);
              clearDraftSlot();
            }
            if (refused) setShowProblems(true);
          }}
        />
      )}

      {loadError && (
        <div className="flex items-center gap-2 border-b border-line bg-err-bg px-4 py-2">
          <p className="text-[12px] text-err">{loadError}</p>
        </div>
      )}

      {/* Both views stay mounted — toggling loses neither the canvas state nor
          the authoring conversation. */}
      <div className={view === "canvas" ? "flex min-h-0 grow" : "hidden"}>
        <Rail side="left" open={leftOpen} onToggle={() => setLeftOpen((v) => !v)} width={268}>
          <Palette
            system={system}
            onAdd={addNode}
            refreshTick={refreshTick}
            selected={selected}
            onGrant={onGrant}
          />
        </Rail>
        <div className="relative flex min-w-0 grow flex-col">
          {restored && (
            <div className="flex shrink-0 items-center gap-2 border-b border-line bg-warn-bg px-3 py-1.5">
              <p className="text-[12px] text-warn">Restored your unsaved work —</p>
              <button
                onClick={() => {
                  rawDispatch({ type: "load", system: EMPTY });
                  clearDraftSlot();
                  setSelected(null);
                  setRestored(false);
                  setDirty(false);
                }}
                className="focusable cursor-pointer text-[12px] font-semibold text-warn underline underline-offset-2"
              >
                Discard
              </button>
              <span className="grow" />
              <button
                onClick={() => setRestored(false)}
                aria-label="Dismiss"
                className="focusable cursor-pointer px-1 text-[13px] leading-none text-warn transition-opacity hover:opacity-70"
              >
                ×
              </button>
            </div>
          )}
          <Canvas
            system={system}
            dispatch={dispatch}
            selected={selected}
            onSelect={select}
            problems={problems}
            onAddAt={addNodeAt}
            canUndo={state.past.length > 0}
            canRedo={state.future.length > 0}
            apiRef={canvasApi}
          />
          {notice && (
            <div className="af-pop pointer-events-none absolute bottom-12 left-1/2 z-30 -translate-x-1/2 rounded-md border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-dim elev-2">
              {notice}
            </div>
          )}
          <Problems
            problems={system.nodes.length ? problems : []}
            empty={system.nodes.length === 0}
            open={showProblems}
            setOpen={setShowProblems}
            flash={problemsFlash}
            onJump={(at) => {
              if (!at) return;
              select(at);
              canvasApi.current?.focusNode(at);
            }}
          />
        </div>
        <Rail side="right" open={rightOpen} onToggle={() => setRightOpen((v) => !v)} width={340}>
          <Inspector system={system} dispatch={dispatch} selected={selected} problems={problems} />
        </Rail>
      </div>
      <div className={view === "agent" ? "flex min-h-0 grow" : "hidden"}>
        <AuthorPanel
          onApply={(doc) => {
            dispatch({ type: "load", system: fromDocument(doc) });
            setSelected(null);
            setView("canvas");
          }}
        />
      </div>

    </div>
  );
}

/* ═══════════════════ Problems rail ═══════════════════
   Errors block deploy because the runtime refuses them anyway. Warnings ship,
   and each one names a decision somebody should make deliberately rather than
   discover at a client. */

function Problems({
  problems,
  empty,
  open,
  setOpen,
  flash = false,
  onJump,
}: {
  problems: Problem[];
  empty: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
  /** One-shot attention flash, for the Deploy button's errors path. */
  flash?: boolean;
  onJump: (at?: string) => void;
}) {
  const errors = problems.filter((p) => p.severity === "error");
  const warns = problems.filter((p) => p.severity === "warn");

  return (
    <div
      className="flex shrink-0 flex-col border-t border-line bg-surface"
      style={{ animation: flash ? "af-prob-flash 450ms var(--ease-out) 2" : undefined }}
    >
      <style>{`@keyframes af-prob-flash { 50% { background-color: var(--t-err-bg); } }`}</style>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="focusable flex h-9 cursor-pointer items-center gap-3 px-3 text-left transition-colors hover:bg-raise/60"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-faint transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          <path d="M9 6l6 6-6 6" />
        </svg>

        {errors.length > 0 && (
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-err">
            <span className="size-1.5 rounded-[2px] bg-err" />
            {errors.length} blocking
          </span>
        )}
        {warns.length > 0 && (
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-warn">
            <span className="size-1.5 rounded-[2px] bg-warn" />
            {warns.length} to look at
          </span>
        )}
        {!problems.length &&
          (empty ? (
            <span className="text-[12px] font-medium text-faint">Nothing on the canvas yet</span>
          ) : (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-ok">
              <span className="size-1.5 rounded-[2px] bg-ok" />
              Ready to deploy
            </span>
          ))}

        <span className="grow" />
        <span className="hidden font-mono text-[10.5px] text-ghost sm:inline">
          checked against the same rules the runtime enforces
        </span>
      </button>

      {open && problems.length > 0 && (
        <div className="max-h-[184px] overflow-y-auto border-t border-line">
          {problems.map((p, i) => (
            <button
              key={i}
              onClick={() => onJump(p.at)}
              className="focusable flex w-full cursor-pointer items-start gap-2.5 border-b border-line px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-raise/60"
            >
              <span
                className={`mt-[5px] size-1.5 shrink-0 rounded-[2px] ${
                  p.severity === "error" ? "bg-err" : "bg-warn"
                }`}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[12.5px] font-semibold text-fg">{p.title}</span>
                <span className="text-[11.5px] leading-[1.5] text-dim">{p.detail}</span>
                {p.fix && <span className="text-[11.5px] leading-[1.5] text-faint">{p.fix}</span>}
              </span>
              {p.at && (
                <span className="mt-0.5 ml-auto shrink-0 font-mono text-[10px] text-ghost">{p.at}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export { NODE_W, NODE_H };

/* ═══════════════════ Collapsible rails ═══════════════════
   Collapsed, a rail folds to a slim tab rather than vanishing — a control that
   disappears with its panel is a control nobody finds again. */

function Rail({
  side,
  open,
  onToggle,
  width,
  children,
}: {
  side: "left" | "right";
  open: boolean;
  onToggle: () => void;
  width: number;
  children: React.ReactNode;
}) {
  // A collapsed rail peeks open on hover and folds back on leave. Pinning
  // (the chevron) is what keeps it open; the peek costs nothing to abandon.
  // The peek is an overlay — the aside keeps its 24px in layout, so peeking
  // never shoves the canvas around.
  const [peek, setPeek] = useState(false);
  const expanded = open || peek;
  const border = side === "left" ? "border-r" : "border-l";
  const chevron = (open ? side === "left" : side === "right") ? "M14 6l-6 6 6 6" : "M10 6l6 6-6 6";

  return (
    <aside
      onPointerEnter={() => {
        if (!open) setPeek(true);
      }}
      onPointerLeave={() => setPeek(false)}
      style={{ width: open ? width : 24 }}
      className={`relative flex h-full shrink-0 flex-col ${border} border-line bg-surface transition-[width] duration-200 ease-[var(--ease-out)]`}
    >
      <button
        onClick={onToggle}
        aria-label={open ? "Collapse panel" : "Expand panel"}
        title={open ? "Collapse" : "Expand"}
        className={`focusable absolute top-1/2 z-30 grid h-12 w-[22px] -translate-y-1/2 cursor-pointer place-items-center text-faint transition-colors hover:text-fg ${
          side === "left" ? "right-0" : "left-0"
        } ${expanded ? "" : "inset-x-0 mx-auto"}`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={chevron} />
        </svg>
      </button>
      <div
        style={{ width }}
        className={`min-h-0 ${side === "left" ? "pr-[22px]" : "pl-[22px]"} ${
          open
            ? "h-full"
            : peek
              ? `absolute inset-y-0 z-20 ${side === "left" ? "left-0 border-r" : "right-0 border-l"} border-line bg-surface elev-2`
              : `pointer-events-none absolute inset-y-0 opacity-0 ${side === "left" ? "left-0" : "right-0"}`
        }`}
      >
        {children}
      </div>
    </aside>
  );
}
