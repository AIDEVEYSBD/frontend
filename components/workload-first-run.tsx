"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, Status, type Tone } from "./ui";
import { Banner } from "./overlays";
import { RunLink, count, runStateMeta, shortWhen } from "./finding-marks";
import { Card, Facts, Note } from "./workload-parts";
import { api, errorText } from "@/lib/api/client";
import { soon } from "@/lib/soon";
import { RUN_PHASES, readRun, runIsOpen, type RunLike, type RunPhase, type RunReading } from "@/lib/workloads";

/**
 * The "First run" step: follow the run the set-up started and say, in plain
 * words, where it is.
 *
 * It reads the run's record (`GET /api/runs/{id}`, the door the Runs page
 * reads) every few seconds while the run is open: started, waiting at a gate
 * (who must answer, and where), refused (the control that refused, from the
 * run's journal), failed (the error as recorded), or finished (links to the
 * run, its findings and its deliverables). Every word about the run comes
 * from its record; with no run in the address it says so and shows only what
 * the five places mean.
 */

const FAST_MS = 2500;
const SLOW_MS = 8000;

interface Got {
  id: string;
  run: RunLike | null;
  error: string;
}

/** A run's record, read again while it can still change. */
function useRun(id: string): { run: RunLike | null; error: string; reading: boolean; retry: () => void } {
  const [got, setGot] = useState<Got | null>(null);
  const [tick, setTick] = useState(0);
  const mine = got && got.id === id ? got : null;
  const state = mine?.run?.state ?? "";
  // A run under way is read often, one waiting for a person less often, a settled one once.
  const every = !mine ? FAST_MS : !mine.run ? 0 : state === "running" ? FAST_MS : runIsOpen(state) ? SLOW_MS : 0;

  useEffect(() => {
    if (!id) return;
    let stop = false;
    const load = async () => {
      try {
        const { data, error, response } = await api.GET("/api/runs/{run_id}", { params: { path: { run_id: id } } });
        if (stop) return;
        if (data) setGot({ id, run: data as RunLike, error: "" });
        else setGot((prev) => ({ id, run: prev && prev.id === id ? prev.run : null, error: errorText(error, response) }));
      } catch (e) {
        if (!stop) setGot((prev) => ({ id, run: prev && prev.id === id ? prev.run : null, error: (e as Error).message }));
      }
    };
    const cancel = soon(load);
    const timer = every ? setInterval(load, every) : null;
    return () => {
      stop = true;
      cancel();
      if (timer) clearInterval(timer);
    };
  }, [id, every, tick]);

  return { run: mine?.run ?? null, error: mine?.error ?? "", reading: !mine, retry: () => setTick((t) => t + 1) };
}

const PHASE_TONE: Record<RunPhase | "other", Tone> = { started: "run", gate: "warn", refused: "err", failed: "err", finished: "ok", other: "neutral" };

const plural = (n: number, one: string, many: string): string => `${count(n)} ${n === 1 ? one : many}`;

/** The headline and the sentence under it, from the record. */
function wordsOf(r: RunReading): { title: string; body: string } {
  if (r.phase === "started") return { title: "Started", body: "The agent is working on what was handed over. Nothing is needed from you; this step reads the run again every few seconds." };
  if (r.phase === "gate") return { title: "Waiting at a gate", body: "The run has stopped and waits for a person's answer. It goes no further until the gate is answered." };
  if (r.phase === "finished") {
    const along = r.refusals.reduce((n, x) => n + x.times, 0);
    return { title: "Finished", body: along ? `The run completed. Along the way ${plural(along, "step was", "steps were")} refused by a control; they are listed below.` : "The run completed." };
  }
  if (r.phase === "refused") {
    if (r.person) {
      const who = r.person.by || "A person";
      return r.person.closed
        ? { title: "Closed at the gate", body: `${who} closed the run at a gate, so it went no further.` }
        : { title: "Refused at the gate", body: `${who} answered a gate with a refusal, so the run went no further.` };
    }
    if (r.state === "closed") return { title: "Closed at the gate", body: `The run was closed at a gate and went no further. ${r.answer ? "The answer its journal recorded is below." : "Its record does not carry the answer; open the run to read its journal."}` };
    return { title: "Refused by a control", body: "The run did not finish: a control refused a step, and the run ended there. What was refused, and by which control, is below as the run's journal recorded it." };
  }
  if (r.phase === "failed") {
    if (r.state === "killed") return { title: "Stopped by an operator", body: "An operator stopped the run before it finished." };
    return { title: "Failed", body: "The run ended with an error before it finished. The error is below as the run recorded it." };
  }
  return { title: r.state ? `State: ${r.state}` : "State not recorded", body: "The run's record carries a state this step does not explain. Open the run to read its journal." };
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-semibold text-dim">{title}</span>
      {children}
    </div>
  );
}

function Said({ children }: { children: ReactNode }) {
  return <p className="max-w-[96ch] rounded-md border border-line bg-canvas px-3 py-2 text-[12px] leading-[1.6] break-words whitespace-pre-wrap text-mist">{children}</p>;
}

function Refusals({ run, reading }: { run: string; reading: RunReading }) {
  if (!reading.refusals.length) return null;
  return (
    <Block title={reading.phase === "finished" ? "Refused along the way" : reading.person || reading.state === "closed" ? "Steps a control refused" : "What refused it"}>
      <ul className="flex flex-col overflow-hidden rounded-md border border-line">
        {reading.refusals.map((x) => (
          <li key={`${x.entry}-${x.control}`} className="flex flex-col gap-1 border-b border-line px-3 py-2.5 last:border-b-0">
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <Status tone="err">Refused by</Status>
              <span className="text-[12.5px] font-semibold text-fg">{x.name}</span>
              {x.name !== x.control && x.control !== "denied" && <span className="font-mono text-[10.5px] text-faint">{x.control}</span>}
              {x.times > 1 && <span className="tnum text-[11px] text-faint">{count(x.times)} times</span>}
              <span className="grow" />
              {x.entry && <RunLink run={run} entry={x.entry}>journal entry</RunLink>}
            </span>
            {(x.tool || x.node) && (
              <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-faint">
                {x.tool && (
                  <span>
                    Tool <span className="font-mono text-[11px] text-dim">{x.tool}</span>
                  </span>
                )}
                {x.node && (
                  <span>
                    Step <span className="font-mono text-[11px] text-dim">{x.node}</span>
                  </span>
                )}
              </span>
            )}
            {x.detail && <span className="text-[12px] leading-[1.55] break-words text-fg">{x.detail}</span>}
            {x.decides && (
              <span className="text-[11.5px] leading-[1.5] text-faint">
                {x.name} decides: {x.decides}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Block>
  );
}

/** What the five places mean, with the one the run is in marked. */
function Places({ at }: { at: RunPhase | "other" | null }) {
  return (
    <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 xl:grid-cols-5">
      {RUN_PHASES.map((p) => {
        const here = at === p.id;
        return (
          <li key={p.id} aria-current={here ? "step" : undefined} className={`flex flex-col gap-1 px-3 py-2.5 sm:max-xl:last:col-span-2 ${here ? "bg-raise" : "bg-surface"}`}>
            <Status tone={here ? PHASE_TONE[p.id] : "neutral"}>{p.label}</Status>
            <span className="text-[11.5px] leading-[1.5] text-faint">{p.means}</span>
            {here && <span className="mt-auto pt-1 text-[11px] font-semibold text-fg">The run is here</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function FirstRun({ run }: { run: string }) {
  const { run: record, error, reading: loading, retry } = useRun(run);

  if (!run) {
    return (
      <Card title="First run" hue="run" meta="no run started from this set-up">
        <p className="max-w-[80ch] text-[12.5px] leading-[1.6] text-dim">
          This step follows the first run once it is started, and says where it is. No run has been started from this set-up yet: start one on the step before, Review and start.
        </p>
        <Block title="Where a first run can be">
          <Places at={null} />
        </Block>
      </Card>
    );
  }

  const r = record ? readRun(record) : null;
  const state = r ? runStateMeta(r.state) : null;
  const w = r ? wordsOf(r) : null;
  const runHref = `/runs?id=${encodeURIComponent(run)}`;

  return (
    <Card
      title="First run"
      hue="run"
      meta={<RunLink run={run} />}
      action={
        state ? (
          <Status tone={state.tone} chip>
            {state.label}
          </Status>
        ) : undefined
      }
    >
      {loading && <p className="text-[12px] text-faint">Reading the run&hellip;</p>}

      {error && (
        <Banner
          tone="err"
          title={record ? "The run could not be read again" : "The run's record could not be read"}
          action={
            <Button size="sm" variant="solid" tone="neutral" onClick={retry}>
              Try again
            </Button>
          }
        >
          {error}
          {record ? " What is shown below is the last record read." : ""}
        </Banner>
      )}

      {r && w && (
        <>
          <Banner tone={PHASE_TONE[r.phase]} title={w.title}>
            {w.body}
          </Banner>

          {r.phase === "started" && (
            <Facts
              items={[
                { k: "Started", v: record?.started_at ? <span className="tnum">{shortWhen(record.started_at)} UTC</span> : <span className="text-faint">The record gives no start time</span> },
                { k: "Latest step recorded", v: r.last ? `${r.last.title}${r.last.node ? ` (${r.last.node})` : ""}` : <span className="text-faint">Nothing recorded yet</span> },
                { k: "Journal entries", v: <span className="tnum">{count(r.entries)}</span> },
              ]}
            />
          )}

          {r.phase === "gate" && (
            <Facts
              items={[
                { k: "Who must answer", v: r.gate?.approvers.length ? r.gate.approvers.join(", ") : <span className="text-faint">The record names no approver</span> },
                { k: "What is asked", v: r.gate?.prompt || <span className="text-faint">The gate carries no question</span> },
                { k: "Gate", v: r.gate?.node ? <span className="font-mono text-[11px] text-dim">{r.gate.node}</span> : <span className="text-faint">Not named</span> },
                ...(r.gate?.deadline ? [{ k: "Answer by", v: <span className="tnum">{shortWhen(r.gate.deadline)} UTC</span> }] : []),
              ]}
            />
          )}

          {r.person && (
            <Facts
              items={[
                { k: r.person.closed ? "Closed by" : "Refused by", v: r.person.by || <span className="text-faint">Not recorded</span> },
                ...(r.person.at ? [{ k: "When", v: <span className="tnum">{shortWhen(r.person.at)} UTC</span> }] : []),
                { k: "Note given", v: r.person.note || <span className="text-faint">None recorded</span> },
                ...(r.person.node ? [{ k: "Gate", v: <span className="font-mono text-[11px] text-dim">{r.person.node}</span> }] : []),
              ]}
            />
          )}

          {!r.person && r.state === "closed" && r.answer && (r.answer.title || r.answer.detail) && (
            <Block title="The answer, as the journal recorded it">
              <Said>{[r.answer.title, r.answer.detail].filter(Boolean).join(": ")}</Said>
            </Block>
          )}

          <Refusals run={run} reading={r} />

          {r.kill && (
            <Facts
              items={[
                { k: "Stopped by", v: r.kill.by || <span className="text-faint">Not recorded</span> },
                { k: "Reason given", v: r.kill.reason || <span className="text-faint">None recorded</span> },
                ...(r.kill.at ? [{ k: "When", v: <span className="tnum">{shortWhen(r.kill.at)} UTC</span> }] : []),
              ]}
            />
          )}

          {(r.phase === "failed" || r.phase === "refused") && (r.error || (r.phase === "failed" && r.state !== "killed")) && (
            <Block title={r.phase === "refused" ? "What the run recorded as it ended" : "The error"}>
              {r.error ? <Said>{r.error}</Said> : <Note>The record carries no error text. The run&rsquo;s journal has the last step it reached.</Note>}
            </Block>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {r.phase === "gate" && (
              <Button size="sm" variant="solid" tone="ink" href="/approvals">
                Open Approvals
              </Button>
            )}
            {r.phase === "finished" && (
              <>
                <Button size="sm" variant="solid" tone="ink" href={`/findings?run=${encodeURIComponent(run)}`}>
                  Findings of this run
                </Button>
                <Button size="sm" variant="solid" tone="neutral" href={`/deliverables?run=${encodeURIComponent(run)}`}>
                  Deliverables
                </Button>
              </>
            )}
            <Button size="sm" variant="solid" tone="neutral" href={runHref}>
              Open the run
            </Button>
          </div>
          {r.phase === "gate" && <Note>The gate is answered in Approvals by a person the gate names. Once it is answered this step moves on by itself.</Note>}
        </>
      )}

      <Block title="Where a first run can be">
        <Places at={r ? r.phase : null} />
      </Block>
    </Card>
  );
}
