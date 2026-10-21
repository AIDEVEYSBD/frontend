"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, RUN_STATE, Status, Tag, type Tone } from "./ui";
import { KillDialog } from "./kill-dialog";
import { RunSourceTag } from "./run-source";
import { DoorError } from "@/lib/api/l5";
import { getRunTree, killRefusalOf, killRun, type KillReceipt, type KillRefusal, type Reached, type RunTree, type TreeNode } from "@/lib/api/l7";
import {
  alreadySummary,
  byAgentRows,
  deliveryText,
  figuresLine,
  fmtCount,
  fmtUsd,
  inFlightNodes,
  isRecordReached,
  killByText,
  killSummary,
  listedDiffers,
  nodeHref,
  nodeKindLabel,
  nodeLinkText,
  peerTaskLine,
  reachedKindLabel,
  reachedStateText,
  refusalLine,
  treeRows,
  treeSummary,
  type TreeRow,
} from "@/lib/run-tree";

/**
 * The run tree: one trace, from the orchestrator down (phase L7,
 * `GET /api/runs/{id}/tree`).
 *
 * An orchestrator's work is spread over records (child runs a worker or an
 * attached agent's SDK ran, a peer's report sharing the trace), in-process
 * sub-runs that live in its own journal, and tasks handed to peers. The
 * panel draws all of it as one outline under the root, each node with its
 * own figures (nothing counted twice) and, where it set anything off, the
 * total under it; the header carries the rollup to the orchestrator, and
 * where the refusals happened. Only a record opens a run page: a sub-run and
 * a peer task are shown, never linked. A replayed run whose tree still has
 * runs in flight offers the kill that reaches them (the door answers
 * `delivery: tree` when the run itself has ended). Shown in the theater
 * under both views, the transcript and the agents board.
 */

export function useRunTree(runId: string | undefined, live: boolean) {
  const [tree, setTree] = useState<RunTree | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(0);
  const load = useCallback(() => {
    if (!runId) return;
    getRunTree(runId)
      .then((t) => {
        setTree(t);
        setError("");
        setStatus(200);
      })
      .catch((e) => {
        setError((e as Error).message);
        setStatus(e instanceof DoorError ? e.status : 0);
      });
  }, [runId]);
  const moving = live || (tree ? inFlightNodes(tree).length > 0 : false);
  useEffect(() => {
    if (!runId) return;
    const first = setTimeout(load, 0);
    // While anything in the tree moves, read it again; a settled tree is read once.
    const id = moving ? setInterval(load, 3000) : undefined;
    return () => {
      clearTimeout(first);
      if (id) clearInterval(id);
    };
  }, [runId, moving, load]);
  return { tree, error, status, reload: load };
}

const STATE_TONE = (s: string): Tone => RUN_STATE[s]?.tone ?? (s === "starting" ? "run" : s === "completed" ? "ok" : s === "failed" || s === "refused" ? "err" : s === "working" || s === "submitted" ? "run" : "neutral");
const STATE_WORD = (s: string): string => (RUN_STATE[s] ? RUN_STATE[s].label : s || "unknown");

const KIND_TONE: Record<TreeNode["kind"], Tone> = { run: "neutral", sub_run: "queue", peer: "run" };

/** The guide lines and the elbow of one row, drawn with borders so they line up at any font size. */
function Guides({ row }: { row: TreeRow }) {
  if (row.level === 0) return null;
  return (
    <span className="flex shrink-0 self-stretch" aria-hidden>
      {row.guides.map((on, i) => (
        <span key={i} className={`relative w-4 shrink-0 ${on ? "before:absolute before:inset-y-0 before:left-[7px] before:border-l before:border-line-strong" : ""}`} />
      ))}
      <span className={`relative w-4 shrink-0 before:absolute before:top-0 before:left-[7px] before:h-[13px] before:w-[8px] before:rounded-bl-[3px] before:border-b before:border-l before:border-line-strong ${row.last ? "" : "after:absolute after:top-[13px] after:bottom-0 after:left-[7px] after:border-l after:border-line-strong"}`} />
    </span>
  );
}

function NodeRow({ row }: { row: TreeRow }) {
  const n = row.node;
  const href = nodeHref(n);
  const title = n.kind === "peer" ? n.agent : n.agent || n.run;
  return (
    <div className={`flex min-w-0 items-stretch gap-0 px-3 ${row.asked ? "bg-run-bg/50" : ""}`}>
      <Guides row={row} />
      <div className="flex min-w-0 grow flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line/70 py-1.5">
        <span className="flex min-w-0 grow basis-[260px] items-center gap-2">
          <span title={nodeLinkText(n)} className="inline-flex shrink-0">
            <Tag tone={KIND_TONE[n.kind]}>{nodeKindLabel(n)}</Tag>
          </span>
          {href ? (
            <Link href={href} className="focusable min-w-0 truncate rounded-sm text-[12.5px] font-semibold text-fg hover:underline" title={`Open run ${n.run}`}>
              {title}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-[12.5px] font-semibold text-fg" title={nodeLinkText(n)}>
              {title}
            </span>
          )}
          <span className="tnum font-mono hidden min-w-0 truncate text-[10px] text-ghost sm:inline">{n.kind === "peer" ? (n.peer?.task_id ? `task ${n.peer.task_id}` : "no task id") : n.run}</span>
          <RunSourceTag run={{ source: n.source }} />
          {n.source === "worker" && <span className="tnum font-mono text-[10px] text-faint">worker</span>}
          {row.asked && <Tag tone="run" solid>this run</Tag>}
        </span>
        <Status tone={STATE_TONE(n.state)}>{STATE_WORD(n.state)}</Status>
        <span className="tnum font-mono text-[10.5px] text-dim" title="This node's own figures: its own entries only">
          {n.kind === "peer" && n.peer
            ? `${n.peer.calls} call${n.peer.calls === 1 ? "" : "s"}${n.peer.tools.length ? ` (${n.peer.tools.join(", ")})` : ""}${n.peer.refused ? ` · ${n.peer.refused} refused` : ""}${n.peer.failed ? ` · ${n.peer.failed} failed` : ""} · ${n.peer.replied ? "replied" : "no reply read"}`
            : figuresLine(n)}
          {n.estimated && <span className="text-warn"> · estimated</span>}
        </span>
        {row.descendants > 0 && (
          <span className={`tnum font-mono text-[10.5px] ${n.total.refusals ? "text-err" : "text-faint"}`} title="This node and everything under it">
            with {row.descendants} under it: {fmtUsd(n.total.cost)} · {fmtCount(n.total.tokens)} tokens{n.total.refusals ? ` · ${n.total.refusals} refusal${n.total.refusals === 1 ? "" : "s"}` : ""}
          </span>
        )}
        {n.listed && listedDiffers(n) && (
          <span className="tnum font-mono text-[10.5px] text-faint" title="This record's row in the runs list: its whole journal, its in-process sub-runs folded in">
            in the runs list: {figuresLine(n.listed)}
          </span>
        )}
        {n.error && <span className="w-full truncate pl-0.5 text-[10.5px] text-err" title={n.error}>{n.error}</span>}
      </div>
    </div>
  );
}

/** One row a kill reached, or (under `already`) one an earlier kill is still stopping. */
function ReachedRow({ r }: { r: Reached }) {
  const peerTask = r.kind === "peer_task" || r.delivery.startsWith("a2a");
  const peer = r.peer || r.agent;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line/70 px-4 py-1.5 last:border-b-0" style={{ paddingLeft: 16 + Math.min(6, r.depth) * 16 }}>
      <Tag tone={r.kind === "sub_run" ? "queue" : r.kind === "job" ? "warn" : peerTask ? (r.delivery === "a2a" ? "run" : "err") : "neutral"}>{reachedKindLabel(r)}</Tag>
      {peerTask && peer ? (
        <Link href={`/peers#peer-${encodeURIComponent(peer)}`} className="focusable rounded-sm text-[12px] font-medium text-fg hover:underline" title={`${peer} in the peer registry`}>
          {peer}
        </Link>
      ) : (
        <span className="text-[12px] font-medium text-fg">{r.agent || "—"}</span>
      )}
      {isRecordReached(r) ? (
        <Link href={`/runs?id=${encodeURIComponent(r.run)}`} className="focusable min-w-0 truncate rounded-sm font-mono text-[10.5px] text-dim hover:underline">
          {r.run}
        </Link>
      ) : (
        <span className="tnum font-mono min-w-0 truncate text-[10.5px] text-faint" title={r.run}>
          {r.kind === "job" ? `job ${r.run}` : peerTask && r.task_id ? `task ${r.task_id}` : r.run}
        </span>
      )}
      <span className="min-w-0 grow text-[11px] text-faint">{r.kill ? `stopping on the kill ${killByText(r.kill)}${r.kill.at ? ` at ${r.kill.at.replace("T", " ").replace(/\.\d+Z$|Z$/, " UTC")}` : ""}` : deliveryText(r.delivery)}</span>
      <span className="tnum font-mono text-[10px] text-ghost">{reachedStateText(r)}</span>
      {peerTask && r.delivery !== "a2a" && !r.kill && (
        <span className="w-full min-w-0 text-[10.5px] leading-[1.45] break-words text-err" title={peerTaskLine(r)}>
          {r.error || "the peer did not confirm the cancel"}
        </span>
      )}
    </li>
  );
}

/**
 * Whom a kill reached and how: the receipt `POST /api/runs/{id}/kill`
 * answers. A task a run in the tree handed a peer is a row of its own
 * (`peer_task`): the peer by its registry id, linked to the Peers page, the
 * task's id at the peer, and, when the signed cancel did not reach it, why.
 * What an earlier kill is still stopping (`already`) is listed apart, with
 * that kill: nothing was thrown at it again.
 */
export function KillReceiptView({ receipt, onDismiss }: { receipt: KillReceipt; onDismiss?: () => void }) {
  return (
    <div className="flex flex-col border-t border-err/40 bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <Status tone="err">Kill reached {receipt.reached.length}</Status>
        <span className="min-w-0 grow text-[11.5px] leading-[1.5] text-dim">{killSummary(receipt)}</span>
        {receipt.kill.reason && <span className="text-[10.5px] text-faint">reason: {receipt.kill.reason}</span>}
        {onDismiss && (
          <Button size="sm" variant="solid" tone="neutral" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </div>
      {receipt.already.length > 0 && (
        <div className="flex flex-col border-t border-line">
          <span className="px-4 pt-1.5 text-[10.5px] text-faint">Already stopping on an earlier kill, not sent another</span>
          <ul className="max-h-[120px] overflow-y-auto">
            {receipt.already.map((r) => (
              <ReachedRow key={`already:${r.kind}:${r.run}`} r={r} />
            ))}
          </ul>
        </div>
      )}
      {receipt.reached.length > 0 && (
        <ul className="max-h-[180px] overflow-y-auto border-t border-line">
          {receipt.reached.map((r) => (
            <ReachedRow key={`${r.kind}:${r.run}`} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A kill that reached nothing new (409 `KillRefused`): the tree is already
 * being stopped. Shown as that, never as an error: who killed it and why,
 * and what is still unwinding.
 */
export function KillAlreadyView({ refusal, onDismiss }: { refusal: KillRefusal; onDismiss?: () => void }) {
  return (
    <div className="flex flex-col border-t border-warn/50 bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <Status tone="warn">Already being stopped</Status>
        <span className="min-w-0 grow text-[11.5px] leading-[1.5] text-dim" title={refusal.error}>
          {alreadySummary(refusal)}
        </span>
        {onDismiss && (
          <Button size="sm" variant="solid" tone="neutral" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </div>
      {refusal.already.length > 0 && (
        <ul className="max-h-[180px] overflow-y-auto border-t border-line">
          {refusal.already.map((r) => (
            <ReachedRow key={`${r.kind}:${r.run}`} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The tree itself: the outline under the root, and the rollup by agent.
 * Presentational, so tests render it from a captured tree.
 */
export function RunTreeBody({ tree, footer }: { tree: RunTree; footer?: React.ReactNode }) {
  const rows = treeRows(tree);
  const agents = byAgentRows(tree);
  const asked = tree.nodes.find((n) => n.run === tree.asked);
  const root = tree.nodes.find((n) => n.run === tree.root);
  return (
    <div className="grid max-h-[300px] min-h-0 gap-px overflow-y-auto border-t border-line bg-line lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 bg-surface">
        {tree.asked !== tree.root && (
          <p className="border-b border-line px-4 py-1.5 text-[11px] text-faint">
            This run is part of a larger tree: the orchestrator is{" "}
            <Link href={`/runs?id=${encodeURIComponent(tree.root)}`} className="focusable rounded-sm font-mono text-[10.5px] text-dim hover:underline">
              {root?.agent ? `${root.agent} · ${tree.root}` : tree.root}
            </Link>
            {asked ? ` (this one sits ${asked.depth} level${asked.depth === 1 ? "" : "s"} below it).` : "."}
          </p>
        )}
        {rows.map((r) => (
          <NodeRow key={r.node.run} row={r} />
        ))}
        {tree.truncated && <p className="px-4 py-1.5 text-[11px] text-warn">The tree has more than {tree.count} nodes; the rest are left out.</p>}
      </div>
      <div className="flex min-w-0 flex-col bg-surface">
        <div className="flex flex-col gap-0.5 border-b border-line px-4 py-2" title={tree.how || undefined}>
          <span className="text-[11px] font-semibold text-dim">Rolled up to the orchestrator{tree.how ? " · as the runs list shows them" : ""}</span>
          <span className="tnum font-mono text-[11px] text-fg">{figuresLine(tree.rollup)}</span>
          <span className={`text-[11px] ${tree.rollup.refusals ? "text-err" : "text-faint"}`}>{refusalLine(tree)}</span>
        </div>
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-line text-left text-[10px] text-faint">
              <th className="px-4 py-1 font-medium">By agent</th>
              <th className="px-1 py-1 text-right font-medium">nodes</th>
              <th className="px-1 py-1 text-right font-medium">cost</th>
              <th className="px-1 py-1 text-right font-medium">tools</th>
              <th className="px-4 py-1 pl-1 text-right font-medium">refused</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.key} className="border-b border-line/70 last:border-b-0">
                <td className="max-w-[140px] truncate px-4 py-1 text-fg" title={a.key}>
                  {a.label}
                  {a.peer && <span className="text-faint"> (peer)</span>}
                </td>
                <td className="tnum px-1 py-1 text-right text-dim">{a.nodes}</td>
                <td className="tnum px-1 py-1 text-right text-dim">{fmtUsd(a.cost)}</td>
                <td className="tnum px-1 py-1 text-right text-dim">{a.tool_calls}</td>
                <td className={`tnum px-4 py-1 pl-1 text-right ${a.refusals ? "font-semibold text-err" : "text-dim"}`}>{a.refusals}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {footer}
      </div>
    </div>
  );
}

export function RunTreePanel({ runId, live }: { runId?: string; live: boolean }) {
  const { tree, error, status, reload } = useRunTree(runId, live);
  const [open, setOpen] = useState<boolean | null>(null);
  const [killAsk, setKillAsk] = useState(false);
  const [killing, setKilling] = useState(false);
  const [receipt, setReceipt] = useState<KillReceipt | null>(null);
  const [already, setAlready] = useState<KillRefusal | null>(null);
  const [killError, setKillError] = useState("");
  if (!runId) return null;
  // Open by itself when there is a tree to show; a run alone stays a line.
  const shown = open ?? Boolean(tree && tree.count > 1);
  const moving = tree ? inFlightNodes(tree) : [];
  const offerKill = Boolean(tree && !live && moving.length > 0);

  return (
    <div className="shrink-0 border-t border-line bg-surface" data-hue="indigo">
      {killAsk && tree && (
        <KillDialog
          title={tree.asked === tree.root ? "Kill what is still running in this tree?" : "Kill this run and what it set off?"}
          what={`${moving.length} node${moving.length === 1 ? " is" : "s are"} still in flight under ${tree.asked}. The kill reaches every descendant where it runs: sub-runs on the run's cancel, child runs here, on their worker or through their SDK, queued children are dead-lettered, and tasks handed to peers are cancelled over A2A, signed. A run waiting at a gate is not killed.`}
          confirm="Kill the tree"
          onClose={() => setKillAsk(false)}
          onConfirm={(reason) => {
            setKillAsk(false);
            setKilling(true);
            setKillError("");
            setAlready(null);
            killRun(tree.asked, reason)
              .then((r) => {
                setReceipt(r);
                reload();
              })
              .catch((e) => {
                const refusal = killRefusalOf(e);
                if (refusal?.already.length) {
                  setAlready(refusal);
                  reload();
                } else setKillError((e as Error).message);
              })
              .finally(() => setKilling(false));
          }}
        />
      )}
      <button type="button" onClick={() => setOpen(!shown)} aria-expanded={shown} className="focusable flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-1.5 text-left hover:bg-raise/40">
        <span className="grid size-3.5 shrink-0 place-items-center text-dim transition-transform" style={{ transform: shown ? "rotate(90deg)" : "none" }} aria-hidden>
          <svg viewBox="0 0 16 16" width="9" height="9" fill="none">
            <path d="M5.5 3.5 10.5 8l-5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-[11.5px] font-medium">Run tree</span>
        <span className={`min-w-0 text-[10.5px] ${tree && tree.rollup.refusals ? "text-err" : "text-faint"}`}>
          {tree ? treeSummary(tree) : error ? (status === 403 ? "not visible to this key" : status === 404 ? "no record of this run yet" : "could not be read") : "reading the tree…"}
        </span>
        {moving.length > 0 && <Status tone="run">{moving.length} in flight</Status>}
        <span className="grow" />
        {tree?.trace_id && <span className="tnum font-mono text-[10px] text-ghost">trace {tree.trace_id}</span>}
      </button>
      {shown && tree && (
        <RunTreeBody
          tree={tree}
          footer={
            <>
              {offerKill && (
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line px-4 py-2">
                  <span className="min-w-0 grow text-[11px] text-faint">{moving.length} still in flight under this run.</span>
                  <Button size="sm" variant="solid" tone="err" permission="run" loading={killing} onClick={() => setKillAsk(true)}>
                    {tree.asked === tree.root ? "Kill the tree" : "Kill this branch"}
                  </Button>
                </div>
              )}
              {killError && <p className="border-t border-line px-4 py-1.5 text-[11px] text-err">{killError}</p>}
            </>
          }
        />
      )}
      {receipt && <KillReceiptView receipt={receipt} onDismiss={() => setReceipt(null)} />}
      {already && <KillAlreadyView refusal={already} onDismiss={() => setAlready(null)} />}
    </div>
  );
}
