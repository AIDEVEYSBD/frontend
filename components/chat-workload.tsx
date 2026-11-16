"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Mono, Status } from "./ui";
import { Pick } from "./select";
import { Markdown } from "./markdown";
import { NotConnected, useDoor } from "./pending";
import { WORKLOADS, ask, type Door, type WorkloadList } from "@/lib/api/pending";

/**
 * Asking a security workload to do something, from chat (feature 2.3).
 *
 * This part is ahead of its door (`chatStart` in lib/api/pending.ts:
 * `POST /api/chat/requests`). The composer is drawn as it will be and stays
 * disabled while nothing serves the workloads it would offer
 * (`GET /api/workloads`); no workload is listed that the control plane did
 * not name. Once the workloads door answers, the composer opens, and a
 * request that still finds no chat door says so in place of a reply.
 *
 * lib/api/pending.ts names the door and not yet its shapes. What is sent
 * and read here is the smallest thing the screen needs:
 *
 *   request  {workload, message}
 *   answer   {id?, state?, run?, reply?, missing?: string[]}
 *
 * and every member of the answer is read only when present.
 */

interface ChatStarted {
  id?: string;
  /** `accepted`, `needs_input`, `refused`, or whatever the door names. */
  state?: string;
  /** The run the request started, when it started one. */
  run?: string;
  /** What the control plane says back, as markdown. */
  reply?: string;
  /** Inputs the workload still needs before it can run. */
  missing?: string[];
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

export function WorkloadChat() {
  const { answer: offered } = useDoor<WorkloadList>("workloads");
  const [workload, setWorkload] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [absent, setAbsent] = useState<Door | null>(null);
  const [error, setError] = useState("");
  const [started, setStarted] = useState<{ workload: string; message: string; answer: ChatStarted } | null>(null);

  const workloads = offered?.state === "ok" ? (offered.data.workloads ?? []) : [];
  const available = workloads.filter((w) => w.status === "available");
  const waiting = workloads.length - available.length;
  // The composer opens only when the control plane has named a workload to ask.
  const connected = offered?.state === "ok" && !absent;
  const chosen = available.find((w) => w.id === workload) ?? available[0];
  const off = !connected || !chosen;

  const submit = async () => {
    const message = draft.trim();
    if (off || !message || busy) return;
    setBusy(true);
    setError("");
    const a = await ask<ChatStarted>("chatStart", { body: { workload: chosen.id, message } });
    setBusy(false);
    if (a.state === "pending") setAbsent(a.door);
    else if (a.state === "error") setError(a.message);
    else {
      setStarted({ workload: chosen.name, message, answer: a.data && typeof a.data === "object" ? a.data : {} });
      setDraft("");
    }
  };

  const reply = started ? text(started.answer.reply) : "";
  const run = started ? text(started.answer.run) : "";
  const missing = started && Array.isArray(started.answer.missing) ? started.answer.missing.filter((m): m is string => typeof m === "string") : [];

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div data-hue="blue" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-raise/55 px-4 py-2.5">
        <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Ask a workload to do something</span>
        <span className="text-[11px] leading-[1.55] text-faint">a request in plain words to an approved security workload, submitted under your own permissions</span>
      </div>

      <div className="grid min-w-0 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form
          className="flex min-w-0 flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-mist">Workload</span>
            <Pick
              size="md"
              aria-label="Workload"
              disabled={off}
              loading={offered === null}
              value={chosen ? String(chosen.id) : ""}
              onChange={setWorkload}
              options={chosen ? available.map((w) => ({ value: String(w.id), label: w.agent ? `${w.name} · ${w.agent}` : w.name })) : [{ value: "", label: offered?.state === "ok" ? "No workload is available" : "Not connected" }]}
            />
            {connected && waiting > 0 && (
              <span className="text-[11.5px] text-faint">
                {waiting} more workload{waiting === 1 ? " is" : "s are"} offered and not deployed yet.
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-mist">Request</span>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              disabled={off}
              aria-label="Request to the workload"
              className="w-full resize-y rounded-md border border-line-strong bg-field px-3 py-2 text-[13px] leading-[1.55] text-fg transition-[border-color,box-shadow] duration-100 placeholder:text-ghost focus:outline-none focus-visible:border-fg focus-visible:ring-2 focus-visible:ring-fg/15 disabled:cursor-not-allowed disabled:bg-raise disabled:text-ghost"
            />
          </div>
          {chosen && chosen.gates.length > 0 && (
            <span className="text-[11.5px] leading-[1.5] text-faint">
              Gates on this workload: {chosen.gates.map((g) => `${g.name} (${g.role}, ${g.when})`).join("; ")}.
            </span>
          )}
          {error && <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">{error}</p>}
          <div className="flex items-start gap-3">
            <span className="min-w-0 grow pt-1 text-[11.5px] leading-[1.5] text-faint">
              {offered === null ? "Asking which workloads this deployment offers…" : off ? "The composer opens once this deployment is connected." : "The request runs with what you are permitted to start, and nothing more."}
            </span>
            <span className="shrink-0">
              <Button type="submit" size="sm" variant="solid" tone="ink" permission="run" loading={busy} disabled={off || !draft.trim()}>
                Submit request
              </Button>
            </span>
          </div>
        </form>

        <div className="flex min-w-0 flex-col gap-3">
          {offered?.state === "error" && <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">The workloads could not be read: {offered.message}</p>}
          {offered?.state === "ok" && available.length === 0 && !absent && (
            <p className="rounded-md border border-line bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-faint">No workload is available on this deployment yet, so there is nothing to ask.</p>
          )}
          {(offered?.state === "pending" || absent) && (
            <NotConnected door="chatStart" compact>
              You will be able to ask a security workload to do something here in plain words ({WORKLOADS.map((w) => w.name.toLowerCase()).join(", ")}). The request is submitted under your own permissions; the
              workload&rsquo;s inputs and approval gates still apply, and the run it starts is on the record like any other.
            </NotConnected>
          )}
          {started && (
            <div className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-canvas p-3">
              <span className="flex flex-wrap items-center gap-2">
                <Status tone={/refus|denied|fail/i.test(text(started.answer.state)) ? "err" : /need|missing|wait/i.test(text(started.answer.state)) ? "warn" : "ok"}>
                  {text(started.answer.state).replace(/_/g, " ") || "submitted"}
                </Status>
                <span className="text-[12px] font-medium text-fg">{started.workload}</span>
                {text(started.answer.id) && <Mono className="text-[10.5px] text-faint">{text(started.answer.id)}</Mono>}
              </span>
              <p className="text-[12.5px] leading-[1.55] break-words whitespace-pre-wrap text-dim">{started.message}</p>
              {reply && (
                <div className="min-w-0 border-t border-line pt-2 text-[13px] leading-[1.6] break-words text-fg">
                  <Markdown text={reply} />
                </div>
              )}
              {missing.length > 0 && <span className="text-[11.5px] leading-[1.5] text-warn">Still needed before it can run: {missing.join(", ")}.</span>}
              {run && (
                <span className="text-[11.5px] text-faint">
                  Started run{" "}
                  <Link href={`/runs?id=${encodeURIComponent(run)}`} className="focusable rounded-sm font-mono text-[10.5px] text-dim underline decoration-line-strong underline-offset-2 hover:decoration-fg">
                    {run}
                  </Link>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
