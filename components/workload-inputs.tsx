"use client";

import type { ReactNode } from "react";
import { Field, Input, Switch, Textarea } from "./forms";
import { Pick } from "./select";
import { DatasetPicker } from "./dataset-picker";
import { kindLabel } from "./dataset-parts";
import { NotGiven } from "./workload-parts";
import { count } from "./finding-marks";
import { listOf, localWhen, valueOf, type DateRange, type InputValue, type InputValues, type WorkloadInput } from "@/lib/workloads";
import type { Dataset } from "@/lib/api/pending";

/**
 * A workload's inputs as a form, and the same inputs read back.
 *
 * One control per kind the workloads door can name: a dataset is the dataset
 * picker of the right kind, a time window is two date-time fields, a list is
 * one entry per line, a choice is a select, a yes-or-no is a switch, anything
 * else is a line of text. Disabled, it is the same form with nothing to type
 * into, so a person sees what will be asked.
 */

const range = (v: InputValue): DateRange => (v && typeof v === "object" ? v : { from: "", to: "" });
const text = (v: InputValue): string => (typeof v === "string" ? v : "");

const need = (i: WorkloadInput): string => (i.required ? "Required" : "Optional");
const hint = (i: WorkloadInput, extra = ""): string => [need(i), extra, (i.help ?? "").trim().replace(/[.!?]$/, "")].filter(Boolean).join(" · ");

export function InputFields({ inputs, values, onChange, disabled = false }: { inputs: WorkloadInput[]; values: InputValues; onChange: (name: string, v: InputValue) => void; disabled?: boolean }) {
  return (
    <div className="flex max-w-[680px] flex-col gap-5">
      {inputs.map((i) => {
        const v = valueOf(i, values);
        if (i.kind === "dataset") {
          return (
            <Field key={i.name} label={i.label} hint={hint(i, i.dataset_kind ? `${kindLabel(i.dataset_kind)} dataset` : "Any dataset")}>
              <DatasetPicker kind={i.dataset_kind} value={text(v) || null} onChange={(id) => onChange(i.name, id)} disabled={disabled} />
            </Field>
          );
        }
        if (i.kind === "date_range") {
          const r = range(v);
          return (
            <fieldset key={i.name} className="flex min-w-0 flex-col gap-1.5">
              <legend className="mb-1.5 text-[12.5px] font-medium text-mist">{i.label}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Starts">
                  <Input type="datetime-local" value={r.from} onChange={(from) => onChange(i.name, { ...r, from })} disabled={disabled} />
                </Field>
                <Field label="Ends">
                  <Input type="datetime-local" value={r.to} onChange={(to) => onChange(i.name, { ...r, to })} disabled={disabled} />
                </Field>
              </div>
              <span className="text-[11.5px] text-faint">{hint(i, "Local time")}</span>
            </fieldset>
          );
        }
        if (i.kind === "list") {
          const n = listOf(text(v)).length;
          return (
            <Field key={i.name} label={i.label} hint={hint(i, `One per line${n ? `, ${count(n)} given` : ""}`)}>
              <Textarea value={text(v)} onChange={(t) => onChange(i.name, t)} rows={5} mono disabled={disabled} />
            </Field>
          );
        }
        if (i.kind === "choice") {
          const choices = Array.isArray(i.choices) ? i.choices.filter((c) => typeof c === "string") : [];
          return (
            <Field key={i.name} label={i.label} hint={hint(i)}>
              <Pick<string> size="md" value={text(v)} onChange={(c) => onChange(i.name, c)} disabled={disabled || choices.length === 0} options={[{ value: "", label: choices.length ? "Choose one" : "No choice is offered" }, ...choices.map((c) => ({ value: c, label: c }))]} />
            </Field>
          );
        }
        if (i.kind === "bool") {
          return (
            <div key={i.name} className="flex flex-col gap-1.5">
              <Switch label={i.label} checked={v === true} onChange={(on) => onChange(i.name, on)} disabled={disabled} />
              {i.help && <span className="text-[11.5px] text-faint">{i.help}</span>}
            </div>
          );
        }
        return (
          <Field key={i.name} label={i.label} hint={hint(i)}>
            <Input value={text(v)} onChange={(t) => onChange(i.name, t)} disabled={disabled} />
          </Field>
        );
      })}
    </div>
  );
}

/** One input's value as the review screen says it. A dataset is named when the datasets door listed it, else by its id. */
export function InputValueText({ input, value, datasets }: { input: WorkloadInput; value: InputValue; datasets?: Dataset[] }): ReactNode {
  if (input.kind === "bool") return value === true ? "Yes" : "No";
  if (input.kind === "date_range") {
    const r = range(value);
    if (!r.from && !r.to) return <NotGiven />;
    return (
      <span className="tnum">
        {r.from ? localWhen(r.from) : "no start"} to {r.to ? localWhen(r.to) : "no end"}
      </span>
    );
  }
  if (input.kind === "list") {
    const items = listOf(text(value));
    if (!items.length) return <NotGiven />;
    return (
      <span className="flex flex-col gap-1">
        <span className="tnum text-[11.5px] text-faint">{count(items.length)} given</span>
        <span className="flex max-h-40 flex-col overflow-y-auto rounded-md border border-line bg-canvas px-2.5 py-1.5 font-mono text-[11px] leading-[1.7] text-mist">
          {items.map((x, k) => (
            <span key={`${x}-${k}`} className="break-all">
              {x}
            </span>
          ))}
        </span>
      </span>
    );
  }
  const t = text(value).trim();
  if (!t) return <NotGiven />;
  if (input.kind === "dataset") {
    const d = datasets?.find((x) => x.id === t);
    return (
      <span className="flex flex-wrap items-baseline gap-x-2">
        {d && <span>{d.name}</span>}
        <span className="font-mono text-[11px] break-all text-faint">{t}</span>
      </span>
    );
  }
  return t;
}
