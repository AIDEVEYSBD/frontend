"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Mono, Tag } from "./ui";
import { Banner, Dialog, EmptyState } from "./overlays";
import { GroupHeader } from "./page-tabs";
import { Chips, FilterBar, SearchBox } from "./filters";
import { DigestChip } from "./digest-chip";
import { Failure, NotConnected, NotConnectedNote, useDoor } from "./pending";
import { notBuilt, notBuiltOf } from "@/lib/not-built";
import { DatasetUpload } from "./dataset-upload";
import { DatasetDialog, DatasetStatus, Fact, KindMark, ModeTag, agoText, filesText, kindLabel, sizeText, whenFull } from "./dataset-parts";
import { DATASET_KINDS, ask, type Dataset, type DatasetList, type Door } from "@/lib/api/pending";
import { errorText } from "@/lib/api/client";

/**
 * Datasets: what a security workload is run on.
 *
 * A dataset is a code snapshot, a firewall export, a telemetry extract or a
 * document. A file handed over is offline; a dataset read from a connection
 * when the run asks is live. The page lists the datasets this deployment
 * holds (door `datasets`), opens one with its digest and the runs that took
 * it (door `dataset`), uploads a new one (door `datasetCreate`) and removes
 * one (door `datasetDelete`) and downloads its file
 * (`GET /api/datasets/{id}/file`). A run reads a dataset through the
 * platform's `dataset.read` tool, and each run that read it is listed under
 * it (`used_by`). While the platform answers 501 for a door, the page says it
 * is not built and shows its structure with no rows.
 */

const MODES = ["offline", "live"] as const;
const COLUMNS = ["Name", "Kind", "Mode", "Data class", "Status", "Size", "Owner", "Added", "Runs"];

function matches(d: Dataset, term: string): boolean {
  if (!term) return true;
  return [d.name, d.id, d.owner?.name, d.owner?.team, d.connection, kindLabel(d.kind)].some((v) => (v ?? "").toLowerCase().includes(term));
}

/** How many runs read it: the count ("none" for an empty list), "not built" while the platform names `used_by` as not built, or "not recorded" when the record does not say. */
function runsText(d: Dataset, unbuilt = false): string {
  if (unbuilt) return "not built";
  if (!Array.isArray(d.used_by)) return "not recorded";
  return d.used_by.length ? d.used_by.length.toLocaleString("en-GB") : "none";
}

/**
 * Save a dataset's file (`GET /api/datasets/{id}/file`): fetched, so a refusal
 * is said in the platform's words instead of saved as the file. Returns the
 * refusal's sentence, or "" when the file was saved.
 */
async function downloadDataset(id: string, fallbackName: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/api/datasets/${encodeURIComponent(id)}/file`, { cache: "no-store", credentials: "include" });
  } catch (e) {
    return `the request did not reach the platform (${(e as Error).message})`;
  }
  if (!res.ok) {
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return errorText(body ?? (text.trimStart().startsWith("<") ? null : text), res, "GET", "/api/datasets/{id}/file");
  }
  const named = (res.headers.get("content-disposition") ?? "").match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] ?? "";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = named ? decodeURIComponent(named) : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "";
}

function DatasetsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get("id");
  const { answer, reload } = useDoor<DatasetList>("datasets");
  const [kind, setKind] = useState("");
  const [mode, setMode] = useState("");
  const [q, setQ] = useState("");
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [now] = useState(() => Date.now());

  const open = useCallback((id: string | null) => router.push(id ? `/datasets?id=${encodeURIComponent(id)}` : "/datasets"), [router]);

  const all = useMemo(() => (answer?.state === "ok" && Array.isArray(answer.data?.datasets) ? answer.data.datasets : []), [answer]);
  /** The list answer names `used_by` as not built: no run is recorded as using a dataset, so the column says so. */
  const usedUnbuilt = answer?.state === "ok" && notBuilt(notBuiltOf(answer.data), "used_by");
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((d) => (!kind || d.kind === kind) && (!mode || d.mode === mode) && matches(d, term));
  }, [all, kind, mode, q]);

  // A dataset still being processed changes on its own: read again until none is.
  const processing = all.some((d) => d.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const id = setInterval(reload, 6000);
    return () => clearInterval(id);
  }, [processing, reload]);

  const pending = answer?.state === "pending";
  const connected = answer?.state === "ok";
  const filters = (kind ? 1 : 0) + (mode ? 1 : 0) + (q.trim() ? 1 : 0);
  const clear = () => {
    setKind("");
    setMode("");
    setQ("");
  };
  const row = selected ? all.find((d) => d.id === selected) ?? null : null;

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <GroupHeader
        group="data"
        tab="datasets"
        actions={
          <span title={pending ? "Not built yet: the platform answers 501" : undefined}>
            <Button variant="solid" tone="ink" permission="run" disabled={!connected} onClick={() => setUploading(true)}>
              Upload a dataset
            </Button>
          </span>
        }
      >
        Uploaded files a security workload runs on.
      </GroupHeader>

      {answer?.state === "error" && (
        <Banner tone="err" title="Could not read the datasets" action={<Button size="sm" variant="solid" tone="neutral" onClick={reload}>Try again</Button>}>
          {answer.message}
        </Banner>
      )}
      {notice && <p className="rounded-md border border-line bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-faint">{notice}</p>}

      {/* filters: kind, mode, search */}
      <div className={`flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3 elev-1 ${connected ? "" : "pointer-events-none opacity-60"}`} aria-disabled={!connected || undefined}>
        <FilterBar count={filters} onClear={clear}>
          <SearchBox value={q} onChange={setQ} placeholder="Search by name, owner or id" />
          <Chips
            label="Kind"
            onToggle={(v) => setKind(kind === v ? "" : v)}
            items={DATASET_KINDS.map((k) => ({ value: k.id, label: k.label, active: kind === k.id, count: connected ? all.filter((d) => d.kind === k.id).length : undefined }))}
          />
          <Chips
            label="Mode"
            onToggle={(v) => setMode(mode === v ? "" : v)}
            items={MODES.map((m) => ({ value: m, label: m, active: mode === m, count: connected ? all.filter((d) => d.mode === m).length : undefined }))}
          />
        </FilterBar>
      </div>

      {/* the list */}
      <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
          <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Datasets on this deployment</span>
          <span className="tnum text-[11px] text-faint">
            {answer === null ? "reading…" : connected ? (filters ? `${shown.length} of ${all.length}` : all.length.toLocaleString("en-GB")) : ""}
          </span>
        </div>
        <div className="af-list af-list-tall overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                {COLUMNS.map((c, i) => (
                  <th key={c} className={`py-2 text-[10.5px] font-medium whitespace-nowrap text-faint ${i === 0 ? "px-4" : "px-3"} ${c === "Size" || c === "Runs" ? "text-right" : "text-left"}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id} onClick={() => open(d.id)} className={`cursor-pointer border-b border-line align-top transition-colors last:border-0 hover:bg-raise/50 ${selected === d.id ? "bg-raise/50" : ""}`}>
                  <td className="max-w-[340px] px-4 py-2.5">
                    <span className="flex items-start gap-2.5">
                      <span className="mt-0.5">
                        <KindMark kind={d.kind} />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <button type="button" onClick={(e) => { e.stopPropagation(); open(d.id); }} className="focusable w-fit max-w-full cursor-pointer truncate rounded-sm text-left text-[12.5px] font-medium text-fg hover:underline">
                          {d.name}
                        </button>
                        <span className="truncate font-mono text-[10.5px] text-faint">{d.id}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[11.5px] whitespace-nowrap text-dim">{kindLabel(d.kind)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <ModeTag mode={d.mode} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Tag>{d.data_class}</Tag>
                  </td>
                  <td className="max-w-[260px] px-3 py-2.5">
                    <span className="flex flex-col gap-0.5">
                      <DatasetStatus status={d.status} />
                      {d.status === "failed" && <span className="text-[11px] leading-[1.45] text-err">{d.error || "The record gives no reason."}</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <span className="flex flex-col items-end">
                      <span className="tnum text-[11.5px] text-fg">{sizeText(d.size_bytes) || <span className="text-ghost">unknown</span>}</span>
                      {d.files !== undefined && <span className="tnum text-[10.5px] text-faint">{filesText(d.files)}</span>}
                    </span>
                  </td>
                  <td className="max-w-[180px] px-3 py-2.5">
                    {d.owner ? (
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[11.5px] text-fg">{d.owner.name}</span>
                        {d.owner.team && <span className="truncate text-[10.5px] text-faint">{d.owner.team}</span>}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-[11.5px] whitespace-nowrap text-dim" title={whenFull(d.created_at)}>
                    {agoText(d.created_at, now)}
                  </td>
                  <td className={`tnum px-3 py-2.5 text-right text-[11.5px] whitespace-nowrap ${d.used_by ? "text-fg" : "text-ghost"}`}>{runsText(d, usedUnbuilt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {answer === null && <p className="px-4 py-4 text-[12px] text-faint">Reading the datasets…</p>}
        {pending && (
          <div className="p-4">
            <NotConnected door={answer.door} />
          </div>
        )}
        {answer?.state === "error" && <p className="px-4 py-4 text-[12px] text-faint">The list could not be read.</p>}
        {connected && all.length === 0 && (
          <div className="p-4">
            <EmptyState
              title="No datasets yet"
              action={
                <Button size="sm" variant="solid" tone="ink" permission="run" onClick={() => setUploading(true)}>
                  Upload a dataset
                </Button>
              }
            />
          </div>
        )}
        {connected && all.length > 0 && shown.length === 0 && (
          <p className="flex flex-wrap items-center gap-3 px-4 py-4 text-[12px] text-faint">
            No dataset matches these filters.
            <Button size="sm" variant="solid" tone="neutral" onClick={clear}>
              Clear filters
            </Button>
          </p>
        )}
      </section>

      {selected && connected && (
        <DatasetDetail
          key={selected}
          id={selected}
          row={row}
          now={now}
          onClose={() => open(null)}
          onRemoved={(name) => {
            setNotice(`${name} was removed.`);
            open(null);
            reload();
          }}
        />
      )}
      {uploading && (
        <DatasetUpload
          onClose={() => setUploading(false)}
          onDone={(d) => {
            setUploading(false);
            setNotice(`${d.name} was uploaded${d.status === "processing" ? " and is being processed" : ""}.`);
            reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * One dataset: what the list said about it at once, then what its own door
 * adds (the digest, the runs that took it). Removing it asks first, and the
 * question names the runs that used it.
 */
function DatasetDetail({ id, row, now, onClose, onRemoved }: { id: string; row: Dataset | null; now: number; onClose: () => void; onRemoved: (name: string) => void }) {
  const { answer } = useDoor<Dataset>("dataset", { params: { id } });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [waits, setWaits] = useState<Door | null>(null);
  const [fetching, setFetching] = useState(false);
  const [refused, setRefused] = useState("");

  const d: Dataset | null = answer?.state === "ok" && answer.data && typeof answer.data.id === "string" ? answer.data : row;
  const used = d?.used_by;

  const remove = async () => {
    if (!d) return;
    setBusy(true);
    setError("");
    const a = await ask<unknown>("datasetDelete", { params: { id } });
    setBusy(false);
    if (a.state === "ok") {
      onRemoved(d.name);
      return;
    }
    setConfirming(false);
    if (a.state === "pending") setWaits(a.door);
    else setError(a.message);
  };

  return (
    <>
      <DatasetDialog
        title={d?.name ?? "Dataset"}
        subtitle={<span className="font-mono text-[10.5px]">{id}</span>}
        width="w-[min(860px,100%)]"
        locked={confirming}
        onClose={onClose}
        footer={
          d ? (
            <>
              <span className="min-w-0 grow text-[11.5px] leading-[1.5] text-faint">
                {refused ? (
                  <Failure inline what="The file was not downloaded" message={refused} />
                ) : waits ? (
                  <NotConnectedNote door={waits} />
                ) : error ? (
                  <span className="text-err">{error}</span>
                ) : null}
              </span>
              {d.mode !== "live" && (
                <Button
                  size="sm"
                  variant="solid"
                  tone="neutral"
                  permission="view"
                  loading={fetching}
                  onClick={async () => {
                    setFetching(true);
                    setRefused(await downloadDataset(id, d.name));
                    setFetching(false);
                  }}
                >
                  Download
                </Button>
              )}
              <Button size="sm" variant="solid" tone="err" permission="configure" onClick={() => setConfirming(true)}>
                Remove
              </Button>
            </>
          ) : undefined
        }
      >
        {!d && answer === null && <p className="px-4 py-4 text-[12px] text-faint">Reading the dataset…</p>}
        {!d && answer?.state === "error" && (<p className="px-4 py-4 text-[12px] text-err">{answer.message}</p>)}
        {!d && answer?.state === "pending" && (
          <div className="p-4">
            <NotConnected door={answer.door} compact />
          </div>
        )}
        {d && (
          <div className="flex flex-col">
            <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
              <Fact k="Kind">
                <KindMark kind={d.kind} />
                {kindLabel(d.kind)}
              </Fact>
              <Fact k="Mode">
                <ModeTag mode={d.mode} />
                <span className="text-[11px] font-normal text-faint">{d.mode === "live" ? "read from a connection at run time" : "a file handed over"}</span>
              </Fact>
              <Fact k="Data class">
                <Tag>{d.data_class}</Tag>
              </Fact>
              <Fact k="Status">
                <DatasetStatus status={d.status} />
              </Fact>
              <Fact k="Size">
                <span className="tnum">{sizeText(d.size_bytes) || <span className="font-normal text-ghost">unknown</span>}</span>
                {d.files !== undefined && <span className="tnum text-[11px] font-normal text-faint">{filesText(d.files)}</span>}
              </Fact>
              <Fact k="Owner">
                {d.owner ? (
                  <>
                    {d.owner.name}
                    {d.owner.team && <span className="text-[11px] font-normal text-faint">{d.owner.team}</span>}
                  </>
                ) : (
                  <span className="font-normal text-ghost">not recorded</span>
                )}
              </Fact>
              <Fact k="Added">
                <span className="tnum">{whenFull(d.created_at)}</span>
                <span className="text-[11px] font-normal text-faint">{agoText(d.created_at, now)}</span>
              </Fact>
              <Fact k="Digest">{d.digest ? <DigestChip digest={d.digest} label="Dataset digest" /> : <span className="font-normal text-ghost">{answer === null ? "reading…" : "not recorded"}</span>}</Fact>
            </div>

            {d.mode === "live" && (
              <p className="border-b border-line px-4 py-2.5 text-[12px] text-dim">
                Reads from the connection {d.connection ? <Mono className="text-[11px] text-fg">{d.connection}</Mono> : <span className="text-ghost">(not named in the record)</span>} when a run asks for it.
              </p>
            )}
            {d.status === "failed" && (
              <p className="border-b border-line px-4 py-2.5 text-[12px] leading-[1.55] text-err">
                Processing failed: {d.error || "the record gives no reason."}
              </p>
            )}
            {d.status === "processing" && <p className="border-b border-line px-4 py-2.5 text-[12px] text-dim">Still being processed.</p>}

            {answer?.state === "pending" && (
              <p className="border-b border-line px-4 py-2.5">
                <NotConnectedNote door={answer.door} />
              </p>
            )}
            {answer?.state === "error" && <p className="border-b border-line px-4 py-2.5 text-[11.5px] text-err">Its record could not be read: {answer.message}</p>}

            {/* the runs that took it */}
            <div className="flex flex-col">
              <div className="flex items-center gap-2 border-b border-line bg-raise/55 px-4 py-2">
                <span className="text-[12px] font-semibold">Runs that used it</span>
                <span className="tnum text-[11px] text-faint">{used && used.length ? used.length.toLocaleString("en-GB") : used ? "none" : answer === null ? "reading…" : "unknown"}</span>
              </div>
              {used === undefined && answer !== null && <p className="px-4 py-3 text-[12px] text-faint">Not recorded.</p>}
              {used && used.length === 0 && <p className="px-4 py-3 text-[12px] text-faint">No run has read it yet.</p>}
              {used && used.length > 0 && (
                <table className="w-full border-collapse text-[11.5px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[10.5px] text-faint">
                      <th className="px-4 py-2 font-medium">Run</th>
                      <th className="px-3 py-2 font-medium">Agent</th>
                      <th className="px-3 py-2 font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {used.map((u) => (
                      <tr key={`${u.run}-${u.at}`} className="border-b border-line last:border-0">
                        <td className="px-4 py-2">
                          <Link href={`/runs?id=${encodeURIComponent(u.run)}`} className="focusable rounded-sm font-mono text-[11px] text-fg hover:underline">
                            {u.run}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-dim">{u.agent}</td>
                        <td className="tnum px-3 py-2 whitespace-nowrap text-dim" title={agoText(u.at, now)}>
                          {whenFull(u.at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </DatasetDialog>

      {confirming && d && (
        <Dialog modal title={`Remove ${d.name}?`} confirm="Remove" cancel="Cancel" tone="err" loading={busy} onConfirm={remove} onClose={() => !busy && setConfirming(false)}>
          <span className="flex flex-col gap-2">
            <span>It will no longer be listed as a run input.</span>
            {used && used.length > 0 && (
              <span className="flex flex-col gap-1">
                <span>
                  {used.length === 1 ? "One run used it" : `${used.length.toLocaleString("en-GB")} runs used it`}:
                </span>
                <span className="flex max-h-[132px] flex-col gap-0.5 overflow-y-auto rounded-sm border border-line bg-canvas px-2 py-1.5">
                  {used.map((u) => (
                    <span key={`${u.run}-${u.at}`} className="flex flex-wrap gap-x-2 text-[11.5px]">
                      <span className="font-mono text-[11px] text-fg">{u.run}</span>
                      <span className="text-faint">{u.agent}</span>
                    </span>
                  ))}
                </span>
              </span>
            )}
          </span>
        </Dialog>
      )}
    </>
  );
}

export function DatasetsView() {
  return (
    <Suspense>
      <DatasetsPage />
    </Suspense>
  );
}
