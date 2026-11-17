"use client";

import { useRef, useState } from "react";
import { Button } from "./ui";
import { NotConnectedNote } from "./pending";
import { DatasetDialog, sizeText } from "./dataset-parts";
import { ask, type Door } from "@/lib/api/pending";
import { ICL, checkList, plural, type ListCheck } from "./compliance-parts";

/**
 * Load the ABB ICL: one CSV file, posted multipart (`file`) to the `iclLoad`
 * door. The dialog states the format it expects and reads the chosen file in
 * the browser to say what it holds before anything is sent. It shows no row
 * of any list: the contents are the client's to supply.
 */

const COLUMNS: { name: string; needed: boolean; what: string }[] = [
  { name: "id", needed: true, what: "The control's identifier in the list. Each id appears once; mappings are kept by it." },
  { name: "title", needed: true, what: "The control's name, as the list writes it." },
  { name: "domain", needed: false, what: "The part of the list the control belongs to. Used to group the controls no catalogue control answers." },
];

export function IclLoad({ replaces, onClose, onDone }: { /** A list is loaded now and this one takes its place. */ replaces: boolean; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ListCheck | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [waits, setWaits] = useState<Door | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const take = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setCheck(null);
    setError("");
    f.text()
      .then((text) => setCheck(checkList(text)))
      .catch(() => setError("The file could not be read in the browser. Choose it again."));
  };

  const problem = !check
    ? ""
    : check.missing.length
      ? `The header row has no ${check.missing.join(" or ")} column.`
      : check.controls === 0
        ? "The file has a header row and no control under it."
        : "";
  const ready = Boolean(file && check && !problem);

  const load = async () => {
    if (!file || !ready) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    const a = await ask<unknown>("iclLoad", { form });
    setBusy(false);
    if (a.state === "pending") {
      setWaits(a.door);
      return;
    }
    if (a.state === "error") {
      setError(a.message);
      return;
    }
    onDone();
  };

  return (
    <DatasetDialog
      title={`Load the ${ICL}`}
      subtitle={replaces ? "One CSV file. It takes the place of the list loaded now." : "One CSV file, with a header row."}
      locked={busy}
      onClose={onClose}
      footer={
        <>
          <span className="min-w-0 grow text-[11.5px] leading-[1.5] text-faint">{check && ready ? `${plural(check.controls, "control")} will be loaded.` : ""}</span>
          <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={!ready || Boolean(waits)} loading={busy} onClick={load}>
            Load the list
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        {waits && (
          <p className="rounded-md border border-line bg-surface px-3 py-2">
            <NotConnectedNote door={waits} />
          </p>
        )}

        {/* the format */}
        <div className="flex flex-col gap-2">
          <span className="text-[12.5px] font-medium text-mist">Expected format</span>
          <p className="text-[12px] leading-[1.55] text-dim">
            A comma-separated file whose first row names the columns, followed by one row per control.
          </p>
          <code className="w-fit rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11.5px] text-fg">id,title,domain</code>
          <dl className="flex flex-col overflow-hidden rounded-md border border-line">
            {COLUMNS.map((c) => (
              <div key={c.name} className="grid grid-cols-[64px_72px_minmax(0,1fr)] items-baseline gap-x-3 border-b border-line px-3 py-2 last:border-b-0">
                <dt className="font-mono text-[11.5px] text-fg">{c.name}</dt>
                <dd className="text-[11px] text-faint">{c.needed ? "required" : "optional"}</dd>
                <dd className="text-[12px] leading-[1.5] text-dim">{c.what}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* the file */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-mist">File</span>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              if (!busy) take(e.dataTransfer.files?.[0]);
            }}
            className={`flex flex-wrap items-center gap-3 rounded-md border border-dashed px-3 py-3 transition-colors duration-100 ${over ? "border-fg bg-raise/60" : "border-line-strong bg-canvas"}`}
          >
            <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-label="CSV file to load" onChange={(e) => take(e.target.files?.[0])} />
            {file ? (
              <span className="flex min-w-0 grow flex-col">
                <span className="truncate font-mono text-[12px] text-fg">{file.name}</span>
                <span className="tnum text-[11px] text-faint">{sizeText(file.size)}</span>
              </span>
            ) : (
              <span className="min-w-0 grow text-[12px] leading-[1.5] text-dim">Drop the CSV file here, or choose it.</span>
            )}
            <Button size="sm" variant="solid" tone="neutral" disabled={busy} onClick={() => input.current?.click()}>
              {file ? "Choose another" : "Choose a file"}
            </Button>
          </div>
        </div>

        {/* what the chosen file holds */}
        {file && check && (
          <div className="flex flex-col gap-2 rounded-md border border-line bg-canvas p-3">
            <span className="text-[11px] font-medium text-faint">What the file holds</span>
            <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
              <dt className="text-faint">Controls</dt>
              <dd className="tnum text-fg">{check.missing.includes("id") ? <span className="text-ghost">not counted</span> : check.controls.toLocaleString("en-GB")}</dd>
              <dt className="text-faint">Domains</dt>
              <dd className="tnum text-fg">{check.hasDomain ? check.domains.toLocaleString("en-GB") : <span className="text-ghost">no domain column</span>}</dd>
            </dl>
            {check.repeated > 0 && <span className="text-[11.5px] leading-[1.5] text-warn">{plural(check.repeated, "row repeats", "rows repeat")} an id already used above it in the file.</span>}
            {check.blank > 0 && <span className="text-[11.5px] leading-[1.5] text-warn">{plural(check.blank, "row has", "rows have")} no id.</span>}
          </div>
        )}

        <p className="text-[11.5px] leading-[1.55] text-faint">
          The mapping to the catalogue is kept by id. A mapping to an id the loaded list does not have is shown as not in the list until it is removed.
        </p>

        {(problem || error) && (
          <p role="alert" className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">
            {problem || error}
          </p>
        )}
      </div>
    </DatasetDialog>
  );
}
