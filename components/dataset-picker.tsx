"use client";

import { useEffect, useMemo, useState } from "react";
import { Pick } from "./select";
import { NotConnectedNote, useDoor } from "./pending";
import { DatasetUpload } from "./dataset-upload";
import { kindLabel, sizeText } from "./dataset-parts";
import type { Dataset, DatasetKind, DatasetList } from "@/lib/api/pending";

/**
 * Pick the dataset a run takes as an input.
 *
 * A select of the ready datasets (door `datasets`), of one kind when `kind`
 * is given, with "Upload a new one", which opens the upload dialog and
 * selects what it made. `value` is a dataset id, or null for none. While
 * nothing serves the door the select is disabled and says what it waits for.
 * A dataset already chosen that is not ready (just uploaded and still being
 * processed, failed, or no longer listed) stays in the list, named for what
 * it is, so the choice is never silently dropped.
 */

const NONE = "";
const UPLOAD = "__upload__";

export function DatasetPicker({ kind, value, onChange, disabled }: { kind?: DatasetKind; value: string | null; onChange: (id: string | null) => void; disabled?: boolean }) {
  const { answer, reload } = useDoor<DatasetList>("datasets");
  const [uploading, setUploading] = useState(false);
  /** What the upload answered with, until the list carries it. */
  const [made, setMade] = useState<Dataset | null>(null);

  const all = useMemo(() => {
    const listed = answer?.state === "ok" && Array.isArray(answer.data?.datasets) ? answer.data.datasets : [];
    return made && !listed.some((d) => d.id === made.id) ? [made, ...listed] : listed;
  }, [answer, made]);
  const ready = useMemo(() => all.filter((d) => d.status === "ready" && (!kind || d.kind === kind)), [all, kind]);
  const chosen = value ? all.find((d) => d.id === value) ?? null : null;

  // The chosen dataset is still being processed: read again until it settles.
  const waiting = chosen?.status === "processing";
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(reload, 6000);
    return () => clearInterval(id);
  }, [waiting, reload]);

  const label = (d: Dataset) => [d.name, kind ? "" : kindLabel(d.kind), sizeText(d.size_bytes)].filter(Boolean).join(" · ");
  const of = kind ? kindLabel(kind).toLowerCase() : "dataset";

  const connected = answer?.state === "ok";
  const placeholder = answer === null ? "Reading the datasets…" : answer.state === "pending" ? "Not built yet" : answer.state === "error" ? "Could not be read" : ready.length ? `Choose a ${of}` : `No ready ${of} yet`;
  const options: { value: string; label: string }[] = [{ value: NONE, label: placeholder }];
  if (value && !ready.some((d) => d.id === value)) {
    // Chosen, and not among the ready ones: named for what it is. Without the list, only its id is known.
    const what = chosen ? `${chosen.name} · ${chosen.status === "processing" ? "processing" : chosen.status === "failed" ? "failed" : kindLabel(chosen.kind)}` : connected ? `${value} · not in the list` : value;
    options.push({ value, label: what });
  }
  for (const d of ready) options.push({ value: d.id, label: label(d) });
  if (connected) options.push({ value: UPLOAD, label: "Upload a new one" });

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Pick<string>
        size="md"
        value={value ?? NONE}
        options={options}
        disabled={disabled || !connected}
        loading={answer === null}
        aria-label={kind ? `${kindLabel(kind)} dataset` : "Dataset"}
        onChange={(v) => {
          if (v === UPLOAD) setUploading(true);
          else onChange(v === NONE ? null : v);
        }}
      />
      {answer?.state === "pending" && <NotConnectedNote door={answer.door} />}
      {answer?.state === "error" && <span className="text-[11.5px] leading-[1.5] text-err">The datasets could not be read: {answer.message}</span>}
      {connected && chosen?.status === "processing" && <span className="text-[11.5px] text-faint">Still being processed.</span>}
      {connected && chosen?.status === "failed" && <span className="text-[11.5px] leading-[1.5] text-err">Processing failed: {chosen.error || "the record gives no reason."}</span>}
      {connected && value && !chosen && <span className="text-[11.5px] text-faint">This dataset is not in the list any more.</span>}
      {uploading && (
        <DatasetUpload
          kind={kind}
          onClose={() => setUploading(false)}
          onDone={(d) => {
            setUploading(false);
            setMade(d);
            onChange(d.id);
            reload();
          }}
        />
      )}
    </div>
  );
}
