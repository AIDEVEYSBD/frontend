"use client";

import { useState } from "react";
import { Field, Input } from "./forms";
import { ReasonDialog } from "./retrieval-access-parts";
import type { BudgetHold, BudgetHoldDecision, BudgetMeasure } from "@/lib/api/pending";

/**
 * What the budget section of the Approvals page and its two dialogs share:
 * how a ceiling and an amount are worded in each unit, and the question a
 * decision is asked through. Nothing here holds a record.
 */

/* ═══════════════════ amounts ═══════════════════ */

const MEASURE_LABEL: Record<BudgetMeasure, string> = { tool_calls: "Tool calls", tokens: "Tokens", cost_usd: "Cost", wall_clock_s: "Elapsed time" };

/** The ceiling a run reached, as the page names it; one the page does not know is shown as it was sent. */
export const measureLabel = (m: string): string => MEASURE_LABEL[m as BudgetMeasure] ?? m.replace(/_/g, " ");

const whole = (n: number): string => Math.round(n).toLocaleString("en-GB");

/** Dollars and cents; a sum under a dollar keeps the fractions of a cent it was sent with. */
function dollars(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: Math.abs(n) < 1 ? 4 : 2 });
}

/** Seconds as minutes and seconds: `45s`, `30m`, `30m 12s`, `1h 5m`, `1h 5m 9s`. */
export function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (!h && !m) return `${s}s`;
  return [h ? `${h}h` : "", m ? `${m}m` : "", s ? `${s}s` : ""].filter(Boolean).join(" ");
}

/** An amount in the unit of its ceiling: `1,200 calls`, `2,013,482 tokens`, `$25.37`, `30m 12s`. */
export function amount(measure: string, n: number): string {
  if (!Number.isFinite(n)) return "not recorded";
  switch (measure) {
    case "tool_calls":
      return `${whole(n)} call${Math.round(n) === 1 ? "" : "s"}`;
    case "tokens":
      return `${whole(n)} token${Math.round(n) === 1 ? "" : "s"}`;
    case "cost_usd":
      return dollars(n);
    case "wall_clock_s":
      return duration(n);
    default:
      return n.toLocaleString("en-GB");
  }
}

/** Used against the ceiling, in words: `1,200 of 1,200 calls used`, `$25.37 of $25.00 spent, $0.37 over`. */
export function usedLine(h: Pick<BudgetHold, "measure" | "used" | "limit">): string {
  const over = h.used > h.limit ? `, ${amount(h.measure, h.used - h.limit)} over` : "";
  switch (h.measure) {
    case "tool_calls":
      return `${whole(h.used)} of ${amount(h.measure, h.limit)} used${over}`;
    case "tokens":
      return `${whole(h.used)} of ${amount(h.measure, h.limit)} used${over}`;
    case "cost_usd":
      return `${dollars(h.used)} of ${dollars(h.limit)} spent${over}`;
    case "wall_clock_s":
      return `ran ${duration(h.used)} of ${duration(h.limit)}${over}`;
    default:
      return `${amount(h.measure, h.used)} of ${amount(h.measure, h.limit)} used${over}`;
  }
}

/** How long, short: `40s`, `12m`, `3h 5m`, `2d 4h`. */
export function waited(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const holdAgent = (h: Pick<BudgetHold, "agent" | "agent_name">): string => h.agent_name || h.agent;

/* ═══════════════════ the two decisions ═══════════════════ */

/** A typed number: digits with optional thousands separators and, for money, a decimal part. NaN when it is not one. */
function parse(text: string, decimals: boolean): number {
  const t = text.trim().replace(/^\$/, "").replace(/[,\s]/g, "");
  if (!t) return NaN;
  return (decimals ? /^\d+(\.\d+)?$/ : /^\d+$/).test(t) ? Number(t) : NaN;
}

const UNIT_WORD: Record<string, string> = { tool_calls: "in tool calls", tokens: "in tokens", cost_usd: "in dollars" };

/**
 * Decide a run paused at its budget. Continuing takes the new ceiling, in
 * the unit of the one it reached and above what the run has used; stopping
 * takes nothing but the reason. Both are recorded with who decided.
 */
export function DecideDialog({ hold: h, decision, busy, onConfirm, onClose }: { hold: BudgetHold; decision: BudgetHoldDecision["decision"]; busy: boolean; onConfirm: (body: BudgetHoldDecision) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [mins, setMins] = useState("");
  const [secs, setSecs] = useState("");
  const [pressed, setPressed] = useState(false);

  const agent = holdAgent(h);
  const what = measureLabel(h.measure).toLowerCase();
  const reached = (
    <span>
      <span className="font-medium text-fg">{agent}</span> paused at its ceiling for {what}: {usedLine(h)}.
    </span>
  );

  if (decision === "stop") {
    return (
      <ReasonDialog
        title={`Stop run ${h.run}?`}
        confirm="Stop the run"
        tone="err"
        permission="approve"
        busy={busy}
        hint="Recorded with the decision and your name."
        missing="A reason is needed."
        placeholder="Why this run stops here."
        onClose={onClose}
        onConfirm={(reason) => onConfirm({ decision: "stop", reason })}
      >
        {reached}
        <span>Stopping ends the run where it paused.</span>
      </ReasonDialog>
    );
  }

  const time = h.measure === "wall_clock_s";
  const typed = time ? Boolean(mins.trim() || secs.trim()) : Boolean(text.trim());
  const value = time ? (mins.trim() ? parse(mins, false) : 0) * 60 + (secs.trim() ? parse(secs, false) : 0) : parse(text, h.measure === "cost_usd");
  const valid = typed && Number.isFinite(value) && value > h.used;
  const problem = !typed
    ? "Enter the new ceiling."
    : !Number.isFinite(value)
      ? time || h.measure !== "cost_usd"
        ? "Enter whole numbers only."
        : "Enter an amount in dollars."
      : value <= h.used
        ? `It must be above what the run has used: ${amount(h.measure, h.used)}.`
        : "";
  // The difference is shown as soon as the number stands; a problem only once something is typed or confirm was pressed.
  const error = !valid && (typed || pressed) ? problem : undefined;
  const hint = `Above ${amount(h.measure, h.used)}, which the run has used.`;

  return (
    <ReasonDialog
      title={`Continue run ${h.run} with a raised budget?`}
      confirm="Continue the run"
      tone="ink"
      permission="approve"
      busy={busy}
      ready={valid}
      onBlocked={() => setPressed(true)}
      hint="Recorded with the decision and your name."
      missing="A reason is needed."
      placeholder="Why this run may use more."
      onClose={onClose}
      onConfirm={(reason) => onConfirm({ decision: "continue", raise_to: value, reason })}
    >
      {reached}
      {time ? (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="New ceiling, minutes">
              <Input value={mins} onChange={setMins} disabled={busy} invalid={Boolean(error)} autoComplete="off" />
            </Field>
            <Field label="and seconds">
              <Input value={secs} onChange={setSecs} disabled={busy} invalid={Boolean(error)} autoComplete="off" />
            </Field>
          </div>
          {error ? (
            <span role="alert" className="text-[11.5px] text-err">
              {error}
            </span>
          ) : (
            <span className="text-[11.5px] text-faint">{hint}</span>
          )}
        </div>
      ) : (
        <Field label={`New ceiling, ${UNIT_WORD[h.measure] ?? "in the same unit"}`} error={error} hint={hint}>
          <Input value={text} onChange={setText} disabled={busy} prefix={h.measure === "cost_usd" ? "$" : undefined} autoComplete="off" />
        </Field>
      )}
      {valid && (
        <span className="rounded-sm border border-line bg-canvas px-2 py-1.5 text-[12px] leading-[1.5] text-fg">
          {value > h.limit ? `From ${amount(h.measure, h.limit)} to ${amount(h.measure, value)}` : `Ceiling ${amount(h.measure, value)}`}: {amount(h.measure, value - h.used)} more before it pauses again.
        </span>
      )}
    </ReasonDialog>
  );
}
