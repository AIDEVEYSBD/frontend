"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Mono, Spinner } from "./ui";
import { CURRENT_USER } from "@/lib/user";
import { useSession } from "@/lib/use-session";
import { pageFor } from "@/lib/assistant";
import { AssistantChart, ChartDrawing, parseChart } from "./assistant-charts";
import { Markdown } from "./markdown";

/**
 * The console assistant: a bubble at the bottom right of every page.
 *
 * It answers questions about what the console shows from the platform
 * service's own records (`GET` and `POST /api/assistant`): the service reads
 * them itself with the asking person's permissions and can change nothing.
 * The drawer sends the conversation and the page's path and title, nothing
 * else. Every question and its answer, or why there is none, is kept by the
 * service with who asked.
 *
 * The bubble is shown whenever the service answers the first read: when no
 * model is offered, the drawer says so with the service's reason; when the
 * read fails, it says that.
 *
 * The conversation is kept in this browser for the session, so it survives
 * moving between pages.
 */

/**
 * Pages call this with the figures they have loaded. The assistant does not
 * take them: it reads the service's records itself, as the person asking, so
 * what a browser holds is never passed off as a record. Kept so that the pages
 * that call it need no change; it does nothing.
 */
export function usePageFacts(next: Record<string, unknown> | null): void {
  void next;
}

/** What `GET /api/assistant` says: whether a model is offered, which, or why not; and the reads the service may make for this person. */
interface Availability {
  available: boolean;
  model: string | null;
  reason: string | null;
  reads: { name: string; description: string }[];
}

/* ── the conversation ── */

interface Turn { role: "user" | "assistant"; content: string; tools?: string[]; error?: string }

const STORE = "af.assistant";
const TOOL_LABEL: Record<string, string> = {
  overview: "reading the overview",
  agents: "reading the agents",
  runs: "reading the runs",
  run_record: "reading a run record",
  approvals: "reading the approval queue",
  attention: "reading the attention queue",
  knowledge: "reading the knowledge base",
  search_knowledge: "searching the knowledge passages",
  connectors: "reading the connectors",
  models: "reading the models offered",
  audit_trail: "reading the audit trail",
};

/** The bubble at the bottom right, and the panel it opens. */
export function Assistant() {
  const [open, setOpen] = useState(false);
  // What the service said when asked whether the assistant can answer, or why that could not be read. Null until it has answered.
  const [state, setState] = useState<{ ok: Availability } | { failed: string } | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/assistant", { cache: "no-store" })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as (Availability & { error?: string; phase?: number }) | null;
        if (!r.ok || !d) throw new Error(d?.error ? `${d.error}${d.error === "not built" && d.phase ? ` (phase ${d.phase})` : ""}` : `the server answered ${r.status}`);
        if (live) setState({ ok: d });
      })
      .catch((e: Error) => live && setState({ failed: e.message || "the request did not reach the server" }));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (state === null) return null;
  const cannot = "failed" in state ? `The assistant could not be reached: ${state.failed}` : state.ok.available ? null : state.ok.reason || "The assistant cannot answer on this deployment.";
  return (
    <>
      <AssistantPanel open={open} onClose={() => setOpen(false)} cannot={cannot} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close the assistant" : "Ask the assistant"}
        className={`focusable fixed right-5 bottom-5 z-50 flex h-12 items-center gap-2 rounded-full border pr-4 pl-3 text-[12.5px] font-semibold transition-[transform,box-shadow] elev-3 hover:scale-[1.03] ${
          open ? "border-err bg-err text-white hover:brightness-110" : "border-ink bg-ink text-on-ink hover:brightness-110"
        }`}
      >
        {open ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        ) : (
          <SparkIcon size={16} />
        )}
        {open ? "Close" : "Ask"}
      </button>
    </>
  );
}

function AssistantPanel({ open, onClose, cannot }: { open: boolean; onClose: () => void; cannot: string | null }) {
  const pathname = usePathname();
  const page = pageFor(pathname);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const { session: me } = useSession();

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORE);
      if (saved) setTurns(JSON.parse(saved));
    } catch {
      /* fresh conversation */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-30)));
    } catch {
      /* fine */
    }
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50);
  }, [open]);

  const askFrom = useCallback(
    async (base: Turn[], text: string) => {
      const q = text.trim();
      if (!q) return;
      setDraft("");
      const history = [...base, { role: "user" as const, content: q }];
      setTurns([...history, { role: "assistant", content: "", tools: [] }]);
      setBusy(true);
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: history.map((t) => ({ role: t.role, content: t.content })),
            page: { path: pathname, title: page.info.title },
          }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          let msg = `HTTP ${res.status}`;
          try { msg = String((await res.json()).error ?? msg); } catch { /* keep */ }
          throw new Error(msg);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const patch = (fn: (t: Turn) => Turn) =>
          setTurns((prev) => {
            const next = prev.slice();
            next[next.length - 1] = fn(next[next.length - 1]);
            return next;
          });
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, nl);
            buf = buf.slice(nl + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            let ev: { delta?: string; tool?: string; error?: string; done?: boolean };
            try { ev = JSON.parse(line.slice(5)); } catch { continue; }
            if (ev.delta) patch((t) => ({ ...t, content: t.content + ev.delta }));
            if (ev.tool) patch((t) => ({ ...t, tools: [...(t.tools ?? []), ev.tool!] }));
            if (ev.error) patch((t) => ({ ...t, error: ev.error }));
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setTurns((prev) => {
            const next = prev.slice();
            next[next.length - 1] = { ...next[next.length - 1], error: (e as Error).message };
            return next;
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [pathname, page.info.title],
  );
  const ask = useCallback((text: string) => { if (!busy && !cannot) askFrom(turns, text); }, [askFrom, busy, turns, cannot]);

  const clear = () => {
    abort.current?.abort();
    setTurns([]);
    setBusy(false);
  };

  // Re-ask the last question: drop the failed answer and its question, then
  // send the question again so the record reads as one exchange.
  const retry = () => {
    const last = [...turns].reverse().find((t) => t.role === "user");
    if (!last) return;
    const idx = turns.lastIndexOf(last);
    const before = turns.slice(0, idx);
    setTurns(before);
    setTimeout(() => askFrom(before, last.content), 0);
  };

  return (
    <aside
      aria-label="Assistant"
      aria-hidden={!open}
      className={`fixed right-5 bottom-20 z-40 flex h-[min(640px,calc(100vh-112px))] w-[min(420px,calc(100vw-40px))] origin-bottom-right flex-col overflow-hidden rounded-xl border border-line bg-surface elev-3 transition-[opacity,transform] duration-150 ${
        open ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none translate-y-2 scale-95 opacity-0"
      }`}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="grid size-6 place-items-center rounded-md bg-ink text-on-ink"><SparkIcon /></span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-[12.5px] font-semibold">Assistant</span>
          <span className="truncate text-[10px] text-faint">reads this deployment&rsquo;s records · on {page.info.title}</span>
        </span>
        <span className="grow" />
        {turns.length > 0 && (
          <button type="button" onClick={clear} className="focusable flex h-7 items-center rounded-md bg-raise px-2 text-[11px] font-semibold text-fg hover:brightness-110">Clear</button>
        )}
        <button type="button" onClick={onClose} aria-label="Close" className="focusable flex h-7 items-center gap-1 rounded-md bg-err px-2 text-[11px] font-semibold text-white hover:brightness-110">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          Close
        </button>
      </header>

      <div ref={scroller} className="min-h-0 grow overflow-y-auto px-3 py-3">
        {cannot && (
          <p role="alert" className="mb-3 rounded-md border border-err/40 bg-canvas px-3 py-2 text-[12px] leading-[1.55] text-err">{cannot}</p>
        )}
        {turns.length === 0 && !cannot && (
          <div className="flex flex-col gap-3">
            <p className="text-[12px] leading-[1.6] text-faint">
              Ask about what this console shows. Answers are read from this deployment&rsquo;s records with your
              permissions, and the assistant changes nothing. Every question and answer is kept with your name.
            </p>
            <div className="flex flex-col gap-1.5">
              {page.info.suggested.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="focusable rounded-md border border-line bg-canvas px-3 py-2 text-left text-[12px] text-fg transition-colors hover:border-line-strong hover:bg-raise">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="flex items-start justify-end gap-2">
                <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-ink px-3 py-2 text-[12.5px] leading-[1.55] whitespace-pre-wrap text-on-ink">{t.content}</div>
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-raise text-[9px] font-semibold text-fg">{me?.initials ?? CURRENT_USER.initials}</span>
              </div>
            ) : (
              <div key={i} className="flex items-start gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-on-ink"><SparkIcon size={11} /></span>
                <div className="flex min-w-0 max-w-[92%] flex-col gap-1">
                  {(t.tools ?? []).length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {(t.tools ?? []).map((name, k) => (
                        <Mono key={k} className="rounded-sm bg-raise px-1.5 py-px text-[9.5px] text-faint">{TOOL_LABEL[name] ?? name}</Mono>
                      ))}
                    </span>
                  )}
                  {t.content ? (
                    <div className="rounded-lg rounded-tl-sm border border-line bg-canvas px-3 py-2 text-[12.5px] leading-[1.6] text-fg">
                      <Markdown
                        text={t.content}
                        fence={(lang, code, closed) => {
                          if (lang !== "chart" && lang !== "json chart") return closed ? null : <ChartDrawing />;
                          if (!closed) return <ChartDrawing />;
                          const spec = parseChart(code);
                          return spec ? <AssistantChart spec={spec} /> : <p className="my-1 text-[11px] text-faint">The chart could not be drawn from the data given.</p>;
                        }}
                      />
                    </div>
                  ) : busy && i === turns.length - 1 && !t.error ? (
                    <span className="flex items-center gap-2 px-1 py-1 text-[11px] text-faint"><Spinner size={12} /> thinking</span>
                  ) : null}
                  {t.error && (
                    <span className="flex flex-wrap items-center gap-2 px-1 text-[11px] leading-[1.5] text-err">
                      {t.error}
                      {i === turns.length - 1 && !busy && (
                        <button type="button" onClick={retry} disabled={Boolean(cannot)} className="focusable rounded-sm bg-raise px-1.5 py-px text-[10.5px] font-semibold text-fg hover:brightness-110 disabled:opacity-40">Try again</button>
                      )}
                    </span>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
        className="flex shrink-0 items-end gap-2 border-t border-line p-3"
      >
        <textarea
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(draft);
            }
          }}
          rows={2}
          disabled={Boolean(cannot)}
          placeholder={cannot ? "The assistant cannot answer: see above" : `Ask about ${page.info.title.toLowerCase()}…`}
          className="focusable min-h-[40px] grow resize-none rounded-md border border-line bg-canvas px-3 py-2 text-[12.5px] leading-[1.5] text-fg placeholder:text-ghost"
        />
        <Button size="sm" variant="solid" tone="ink" loading={busy} disabled={Boolean(cannot)} onClick={() => ask(draft)}>Send</Button>
      </form>
    </aside>
  );
}

function SparkIcon({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
      <path d="M19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z" opacity=".7" />
    </svg>
  );
}
