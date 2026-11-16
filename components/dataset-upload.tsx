"use client";

import { useRef, useState } from "react";
import { Button } from "./ui";
import { Field, Input } from "./forms";
import { NotConnectedNote } from "./pending";
import { DatasetDialog, KindMark, kindLabel, sizeText } from "./dataset-parts";
import { DATASET_KINDS, DATA_CLASSES, ask, type DataClass, type Dataset, type DatasetKind, type Door } from "@/lib/api/pending";

/**
 * Upload a dataset, in two steps: what it is, then the file, a name and its
 * data class, with a summary of what will be sent before it is.
 *
 * It posts multipart (`file`, `name`, `kind`, `data_class`) to the
 * `datasetCreate` door and hands the dataset the door answers with to
 * `onDone`. A file handed over is always an offline dataset; a live one is
 * read from a connection and is not made here. With `kind` given (the picker
 * asks for one kind) the first step is already answered.
 */
export function DatasetUpload({ kind: fixedKind, onClose, onDone }: { kind?: DatasetKind; onClose: () => void; onDone: (dataset: Dataset) => void }) {
  const [step, setStep] = useState<1 | 2>(fixedKind ? 2 : 1);
  const [kind, setKind] = useState<DatasetKind | null>(fixedKind ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [dataClass, setDataClass] = useState<DataClass | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [waits, setWaits] = useState<Door | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const take = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setError("");
    // The file's own name, without its extension, until the person writes one.
    if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, ""));
  };

  const missing = [!file && "a file", !name.trim() && "a name", !dataClass && "a data class"].filter(Boolean) as string[];
  const ready = Boolean(kind) && missing.length === 0;

  const upload = async () => {
    if (!kind || !file || !dataClass || !name.trim()) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("name", name.trim());
    form.append("kind", kind);
    form.append("data_class", dataClass);
    const a = await ask<Dataset | { dataset: Dataset }>("datasetCreate", { form });
    setBusy(false);
    if (a.state === "pending") {
      setWaits(a.door);
      return;
    }
    if (a.state === "error") {
      setError(a.message);
      return;
    }
    const made = a.data && typeof a.data === "object" && "dataset" in a.data ? a.data.dataset : (a.data as Dataset);
    if (!made || typeof made.id !== "string") {
      setError("The upload was accepted, but the answer did not name the dataset. Reload the list to find it.");
      return;
    }
    onDone(made);
  };

  return (
    <DatasetDialog
      title="Upload a dataset"
      subtitle={step === 1 ? "Step 1 of 2: what it is" : `Step 2 of 2: the file, a name and its data class${kind ? ` · ${kindLabel(kind)}` : ""}`}
      locked={busy}
      onClose={onClose}
      footer={
        step === 1 ? (
          <>
            <span className="grow" />
            <Button size="sm" variant="solid" tone="ink" disabled={!kind} onClick={() => setStep(2)}>
              Next
            </Button>
          </>
        ) : (
          <>
            {!fixedKind && (
              <Button size="sm" variant="outline" tone="ink" disabled={busy} onClick={() => setStep(1)}>
                Back
              </Button>
            )}
            <span className="grow" />
            <Button size="sm" variant="solid" tone="ink" permission="run" disabled={!ready || Boolean(waits)} loading={busy} onClick={upload}>
              Upload
            </Button>
          </>
        )
      }
    >
      {step === 1 ? (
        <div className="flex flex-col gap-3 p-4">
          <p className="text-[12.5px] leading-[1.55] text-dim">Choose what the file is. A workload takes one kind of dataset as its input, so the kind decides where it can be used.</p>
          <div role="radiogroup" aria-label="What it is" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DATASET_KINDS.map((k) => {
              const on = kind === k.id;
              return (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setKind(k.id)}
                  onDoubleClick={() => {
                    setKind(k.id);
                    setStep(2);
                  }}
                  className={`focusable flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors duration-100 ${
                    on ? "border-fg bg-raise/60" : "border-line bg-surface hover:border-line-strong hover:bg-raise/40"
                  }`}
                >
                  <span className={`grid size-8 shrink-0 place-items-center rounded-md ${on ? "bg-ink text-on-ink [&_svg]:text-on-ink" : "bg-raise"}`}>
                    <KindMark kind={k.id} size={16} />
                  </span>
                  <span className="flex min-w-0 grow flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-fg">{k.label}</span>
                    <span className="text-[11.5px] leading-[1.5] text-faint">{k.hint}</span>
                  </span>
                  <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${on ? "border-ink" : "border-line-strong bg-field"}`}>
                    {on && <span className="size-2 rounded-full bg-ink" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-4">
          {waits && (
            <p className="rounded-md border border-line bg-surface px-3 py-2">
              <NotConnectedNote door={waits} />
            </p>
          )}

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
              <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="File to upload" onChange={(e) => take(e.target.files?.[0])} />
              {file ? (
                <span className="flex min-w-0 grow flex-col">
                  <span className="truncate font-mono text-[12px] text-fg">{file.name}</span>
                  <span className="tnum text-[11px] text-faint">{sizeText(file.size)}</span>
                </span>
              ) : (
                <span className="min-w-0 grow text-[12px] leading-[1.5] text-dim">Drop one file here, or choose it. An archive is one file.</span>
              )}
              <Button size="sm" variant="solid" tone="neutral" disabled={busy} onClick={() => input.current?.click()}>
                {file ? "Choose another" : "Choose a file"}
              </Button>
            </div>
          </div>

          <Field label="Name" hint="How the dataset is listed and picked for a run.">
            <Input value={name} onChange={setName} disabled={busy} autoComplete="off" />
          </Field>

          <div className="flex flex-col gap-1.5">
            <span id="dataset-class-label" className="text-[12.5px] font-medium text-mist">
              Data class
            </span>
            <div role="radiogroup" aria-labelledby="dataset-class-label" className="flex flex-wrap gap-1.5">
              {DATA_CLASSES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={dataClass === c}
                  disabled={busy}
                  onClick={() => setDataClass(c)}
                  className={`focusable inline-flex h-8 cursor-pointer items-center rounded-sm border px-3 text-[12.5px] font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40 ${
                    dataClass === c ? "border-transparent bg-ink text-on-ink" : "border-line bg-surface text-dim hover:bg-raise hover:text-fg"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <span className="text-[11.5px] text-faint">The classification of the content, as your organisation labels it.</span>
          </div>

          {/* what will be sent */}
          <div className="flex flex-col gap-2 rounded-md border border-line bg-canvas p-3">
            <span className="text-[11px] font-medium text-faint">What will be uploaded</span>
            <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
              <dt className="text-faint">Kind</dt>
              <dd className="text-fg">{kind ? kindLabel(kind) : <Missing />}</dd>
              <dt className="text-faint">File</dt>
              <dd className="min-w-0 truncate text-fg">
                {file ? (
                  <>
                    <span className="font-mono text-[11px]">{file.name}</span> <span className="tnum text-faint">{sizeText(file.size)}</span>
                  </>
                ) : (
                  <Missing />
                )}
              </dd>
              <dt className="text-faint">Name</dt>
              <dd className="min-w-0 truncate text-fg">{name.trim() || <Missing word="not given" />}</dd>
              <dt className="text-faint">Data class</dt>
              <dd className="text-fg">{dataClass ?? <Missing />}</dd>
              <dt className="text-faint">Mode</dt>
              <dd className="text-fg">offline, a file handed over</dd>
            </dl>
            {missing.length > 0 && <span className="text-[11.5px] text-faint">Still needed: {missing.join(", ")}.</span>}
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">
              {error}
            </p>
          )}
        </div>
      )}
    </DatasetDialog>
  );
}

function Missing({ word = "not chosen" }: { word?: string }) {
  return <span className="text-ghost">{word}</span>;
}
