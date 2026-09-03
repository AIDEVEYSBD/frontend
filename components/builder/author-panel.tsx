"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Label } from "../ui";
import { Banner } from "../overlays";
import { Thinking } from "../loaders";
import { Area } from "./controls";
import { Icon } from "./icons";
import { TOOL_CARDS } from "@/lib/catalogue";
import { HARNESS, HARNESS_ORDER } from "@/lib/spec";

/**
 * The agent-builder view: the canvas's other face. You describe the agent;
 * it designs from the parts that actually exist, proposes through the same
 * parser that guards deployment, and the result lands on the canvas — a
 * draft to review, never a deployment.
 *
 * Every proposal attempt shows in the thread, refusals included, because
 * watching the design converge against real rules is the whole trust story.
 */

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  /** Proposal attempts made while producing this assistant reply. */
  events?: { tool: string; ok: boolean; note: string }[];
  /** A validated draft attached to this reply. */
  draft?: Draft | null;
}

interface Draft {
  id: string;
  document: unknown;
  nodes: string[];
  digest: string;
}

const STAGES = [
  "Reading what exists…",
  "Choosing the harness…",
  "Wiring grants and gates…",
  "Checking against the deployment parser…",
];

const STARTERS = [
  "Test our evidence folder against NIST CSF and score compliance in an Excel workbook",
  "Triage a DLP alert: pull the event, check policy, draft a disposition for approval",
  "Review a vendor's SOC 2 report against our third-party risk questions",
  "Every Monday, brief me on new ransomware campaigns as a formatted PDF",
];

export function AuthorPanel({ onApply }: { onApply: (document: unknown) => void }) {
  const [thread, setThread] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread, busy]);

  // Sized by measurement, not by counting newlines — wrapped lines count too.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 116)}px`;
  }, [input]);

  async function send(text: string, base: ChatMsg[] = thread) {
    const ask = text.trim();
    if (!ask || busy) return;
    setError("");
    setStopped(false);
    setInput("");
    const next: ChatMsg[] = [...base, { role: "user", content: ask }];
    setThread(next);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/author", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(String(data.error ?? `HTTP ${res.status}`));
      setThread((t) => [
        ...t,
        { role: "assistant", content: data.reply ?? "", events: data.events ?? [], draft: data.draft ?? null },
      ]);
    } catch (e) {
      // The user's message stays in the thread either way — retrying resends it.
      if (ctrl.signal.aborted) setStopped(true);
      else setError((e as Error).message);
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 grow flex-col bg-canvas">
      <div className="min-h-0 grow overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-5 py-8">
          {thread.length === 0 && (
            <div className="flex flex-col gap-6 pt-10">
              <div className="flex flex-col gap-2.5">
                <span className="grid size-9 place-items-center rounded-md bg-ink text-on-ink">
                  <Icon name="bot" size={18} />
                </span>
                <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-fg">
                  Describe the agent you need.
                </h2>
                <p className="max-w-[52ch] text-[13px] leading-[1.6] text-dim">
                  It gets designed from the same parts as the canvas — {HARNESS_ORDER.length}{" "}
                  harnesses, {TOOL_CARDS.length} tools — and checked by the same parser that
                  guards deployment. What comes back is a draft on the canvas for you to review
                  and save, never a deployed agent.
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {HARNESS_ORDER.map((k) => (
                  <span
                    key={k}
                    className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-dim"
                  >
                    <span className="size-1.5 rounded-[2px]" style={{ background: `var(${HARNESS[k].token})` }} />
                    {HARNESS[k].name}
                  </span>
                ))}
                {TOOL_CARDS.map((t) => (
                  <span
                    key={t.id}
                    className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-faint"
                  >
                    <Icon name={t.icon} size={11} />
                    {t.label}
                  </span>
                ))}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Try one</Label>
                {STARTERS.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant="outline"
                    className="w-fit max-w-full"
                    loading={busy}
                    onClick={() => send(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {thread.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="ml-auto max-w-[85%] rounded-md bg-raise px-3.5 py-2.5">
                <p className="text-[13px] leading-[1.6] whitespace-pre-wrap text-fg">{m.content}</p>
              </div>
            ) : (
              <div key={i} className="flex max-w-[92%] flex-col gap-2.5">
                {(m.events ?? []).length > 0 && (
                  <div className="flex flex-col gap-1 border-l-2 border-line pl-3">
                    {m.events!.map((ev, j) => (
                      <span key={j} className="flex items-baseline gap-2 font-mono text-[10.5px] leading-[1.5]">
                        <span
                          className={`size-1.5 shrink-0 translate-y-[-1px] rounded-[2px] ${ev.ok ? "bg-ok" : "bg-warn"}`}
                        />
                        <span className={ev.ok ? "text-ok" : "text-warn"}>{ev.tool}</span>
                        <span className="min-w-0 text-faint">{ev.note}</span>
                      </span>
                    ))}
                  </div>
                )}
                {m.content && (
                  <p className="text-[13px] leading-[1.65] whitespace-pre-wrap text-fg">{m.content}</p>
                )}
                {m.draft && (
                  <div className="flex flex-col gap-2.5 rounded-md border border-line bg-surface p-3.5 elev-1">
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-ok text-on-solid">
                        <Icon name="workflow" size={14} />
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="text-[12.5px] font-semibold text-fg">
                          Draft authored — {m.draft.id}
                        </span>
                        <span className="truncate font-mono text-[10px] text-faint">
                          {m.draft.nodes.length} node{m.draft.nodes.length === 1 ? "" : "s"} ·{" "}
                          {m.draft.nodes.join(" → ")}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11.5px] leading-[1.55] text-dim">
                      It passed the deployment parser and is saved as a draft. Open it, review
                      every grant and gate, then Save if it holds up.
                    </p>
                    <div>
                      <Button size="sm" variant="solid" tone="ink" onClick={() => onApply(m.draft!.document)}>
                        Open on canvas
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ),
          )}

          {busy && <BusyWait onStop={() => abortRef.current?.abort()} />}

          {stopped && !busy && <p className="font-mono text-[10.5px] text-ghost">stopped</p>}

          {error && (
            <Banner
              tone="err"
              title="The design request failed"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy}
                  onClick={() => {
                    const at = thread.map((m) => m.role).lastIndexOf("user");
                    if (at < 0) return;
                    send(thread[at].content, thread.slice(0, at));
                  }}
                >
                  Retry
                </Button>
              }
            >
              {error}
            </Banner>
          )}

          <div ref={endRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-[720px] px-5 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-end gap-2"
          >
            <div className="min-w-0 grow">
              <Area
                inputRef={inputRef}
                autoFocus
                resizable={false}
                value={input}
                onChange={setInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                placeholder={thread.length ? "Refine the design…" : "An agent that…"}
                aria-label="Describe the agent"
              />
            </div>
            <Button size="sm" variant="solid" tone="ink" type="submit" disabled={!input.trim()} loading={busy}>
              Send
            </Button>
          </form>
          {thread.length === 0 && (
            <p className="pt-1.5 text-right text-[10.5px] text-ghost">
              Enter to send · Shift+Enter for a new line
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The in-flight state: rotating stage copy, elapsed once it drags, a real stop. */
function BusyWait({ onStop }: { onStop: () => void }) {
  const [sec, setSec] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setSec((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex items-center gap-2.5 text-[12.5px] text-faint">
      <Thinking height={12} />
      <span className="min-w-0 grow truncate">{STAGES[Math.floor(sec / 4) % STAGES.length]}</span>
      {sec > 8 && <span className="tnum shrink-0 font-mono text-[10.5px] text-ghost">{sec}s</span>}
      <Button size="sm" variant="solid" tone="err" onClick={onStop}>
        Stop
      </Button>
    </div>
  );
}
