"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { pageFor } from "./assistant";
import { answerOf, type Answer } from "./answer-blocks";

/**
 * The assistant's conversation, shared by the drawer (components/assistant.tsx)
 * and the full page (/ask).
 *
 * One store per browser tab, outside React: every `useAssistant()` reads the
 * same turns, so a question asked in the drawer keeps streaming when the person
 * opens the full page, and the drawer shows what was asked on the page. The
 * store is copied to `sessionStorage` under `saros.ask.v1` after each change,
 * so a reload keeps the conversation for the session.
 *
 * A question is sent to `POST /api/assistant` with the conversation's words
 * (role and content only: tools, answers and cards stay in the browser) and the
 * page's path and title. The service streams `data:` frames: `{tool}` for each
 * read it makes, `{delta}` for the words, `{answer}` for the blocks, `{error}`
 * and `{done}`.
 */

/** A record or page opened from an answer, drawn inside the conversation under that answer. */
export interface TurnCard {
  href: string;
  label?: string;
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
  /** The reads and layout steps the service took for this answer, by name, in order. */
  tools?: string[];
  answer?: Answer;
  error?: string;
  cards?: TurnCard[];
}

/** What `GET /api/assistant` says: whether a model is offered, which, or why not; and the reads the service may make for this person. */
export interface Availability {
  /** False until the service has answered (or the request failed). */
  checked: boolean;
  /** True when the service says it can answer. False while checking. */
  available: boolean;
  model: string | null;
  /** Why the assistant cannot answer: the service's reason, or why it could not be reached. Null while checking and when it can answer. */
  reason: string | null;
  reads: { name: string; description: string }[];
}

export interface AssistantChat {
  turns: Turn[];
  busy: boolean;
  availability: Availability;
  /** The sentence to show when the assistant cannot answer here (from `availability`), or null. */
  cannot: string | null;
  /** Send a question. Ignored while an answer is coming, when it is blank, or when the assistant cannot answer. */
  ask: (text: string) => void;
  /** Ask the last question again, dropping the failed answer and its question. */
  retry: () => void;
  /** Start a new conversation (the service keeps the record of this one). */
  reset: () => void;
  /** Draw a card for `href` under the answer at `turnIndex`; opening the same href again keeps the one card. */
  openCard: (turnIndex: number, href: string, label?: string) => void;
  closeCard: (turnIndex: number, href: string) => void;
}

/** What each read or layout step is called in the working row. */
export const TOOL_LABEL: Record<string, string> = {
  describe_platform: "Reading what Saros is",
  overview: "Reading the overview",
  agents: "Reading the agents",
  runs: "Reading the runs",
  run_record: "Reading a run record",
  approvals: "Reading the approval queue",
  attention: "Reading the attention queue",
  knowledge: "Reading the knowledge base",
  search_knowledge: "Searching the knowledge passages",
  connectors: "Reading the connectors",
  use_cases: "Reading the use cases",
  findings: "Reading the findings",
  acceptance: "Reading the acceptance records",
  applications: "Reading the applications",
  models: "Reading the models offered",
  audit_trail: "Reading the audit trail",
  show_tiles: "Laying out figures",
  show_table: "Laying out a table",
  show_bars: "Laying out bars",
  show_chart: "Drawing a chart",
  show_steps: "Listing steps",
  show_links: "Adding links",
  show_choices: "Offering choices",
  suggest_followups: "Suggesting questions",
};

export function toolLabel(name: string): string {
  return TOOL_LABEL[name] ?? name.replace(/_/g, " ");
}

/* ── the store ── */

const STORE = "saros.ask.v1";
const KEEP = 30;

interface State {
  turns: Turn[];
  busy: boolean;
  availability: Availability;
}

const CHECKING: Availability = { checked: false, available: false, model: null, reason: null, reads: [] };
const SERVER: State = { turns: [], busy: false, availability: CHECKING };

let state: State = SERVER;
let loaded = false;
let controller: AbortController | null = null;
let checking: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>, persist = true): void {
  state = { ...state, ...next };
  if (persist && "turns" in next) {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(state.turns.slice(-KEEP)));
    } catch {
      /* kept for this page only */
    }
  }
  listeners.forEach((l) => l());
}

function patchLast(fn: (t: Turn) => Turn): void {
  const turns = state.turns.slice();
  const i = turns.length - 1;
  if (i < 0 || turns[i].role !== "assistant") return;
  turns[i] = fn(turns[i]);
  set({ turns });
}

/** The saved conversation, read once per tab. A last answer left blank (the tab reloaded while it streamed) says so, so it can be asked again. */
function load(): void {
  if (loaded) return;
  loaded = true;
  let turns: Turn[] = [];
  try {
    const saved = sessionStorage.getItem(STORE);
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    if (Array.isArray(parsed)) {
      turns = parsed.filter((t): t is Turn => Boolean(t) && typeof t === "object" && (t.role === "user" || t.role === "assistant") && typeof t.content === "string");
    }
  } catch {
    /* a fresh conversation */
  }
  const last = turns[turns.length - 1];
  if (last && last.role === "assistant" && !last.content && !last.answer && !last.error) {
    turns = [...turns.slice(0, -1), { ...last, error: "This answer was interrupted when the page reloaded." }];
  }
  state = { ...state, turns };
}

function check(): void {
  if (checking || (state.availability.checked && state.availability.available)) return;
  checking = fetch("/api/assistant", { cache: "no-store" })
    .then(async (r) => {
      const d = (await r.json().catch(() => null)) as (Partial<Availability> & { error?: string; phase?: number }) | null;
      if (!r.ok || !d) throw new Error(d?.error ? `${d.error}${d.error === "not built" && d.phase ? ` (phase ${d.phase})` : ""}` : `the server answered ${r.status}`);
      const available = d.available === true;
      set(
        {
          availability: {
            checked: true,
            available,
            model: d.model ?? null,
            reason: available ? null : d.reason || "The assistant cannot answer on this deployment.",
            reads: Array.isArray(d.reads) ? d.reads : [],
          },
        },
        false,
      );
    })
    .catch((e: Error) =>
      set({ availability: { ...CHECKING, checked: true, reason: `The assistant could not be reached: ${e.message || "the request did not reach the server"}` } }, false),
    )
    .finally(() => {
      checking = null;
    });
}

function subscribe(listener: () => void): () => void {
  if (!loaded) {
    load();
    // Tell the subscriber the store changed from the server's empty snapshot.
    queueMicrotask(() => listeners.forEach((l) => l()));
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => state;
const serverSnapshot = () => SERVER;

function cannotOf(a: Availability): string | null {
  return a.checked && !a.available ? a.reason || "The assistant cannot answer on this deployment." : null;
}

/** Send `text` after the turns in `base`, and read the answer's frames into the last turn. */
async function send(base: Turn[], text: string, page: { path: string; title: string }): Promise<void> {
  const q = text.trim();
  if (!q) return;
  const history: Turn[] = [...base, { role: "user", content: q }];
  controller?.abort();
  const ac = new AbortController();
  controller = ac;
  set({ turns: [...history, { role: "assistant", content: "", tools: [] }], busy: true });
  const live = () => controller === ac;
  try {
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: history.map((t) => ({ role: t.role, content: t.content })), page }),
      signal: ac.signal,
    });
    if (!res.ok || !res.body) {
      let msg = `The server answered ${res.status}.`;
      try {
        const j = (await res.json()) as { error?: unknown };
        if (j?.error) msg = String(j.error);
      } catch {
        /* keep the status */
      }
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!live()) return;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        let ev: { delta?: string; tool?: string; error?: string; done?: boolean; answer?: unknown };
        try {
          ev = JSON.parse(line.slice(5));
        } catch {
          continue;
        }
        if (ev.tool) patchLast((t) => ({ ...t, tools: [...(t.tools ?? []), ev.tool!] }));
        if (ev.delta) patchLast((t) => ({ ...t, content: t.content + ev.delta }));
        if (ev.answer) {
          const a = answerOf(ev.answer);
          // Null for a text reply (nothing that looks like blocks): the words already arrived as deltas.
          if (a) patchLast((t) => ({ ...t, answer: a }));
        }
        if (ev.error) patchLast((t) => ({ ...t, error: ev.error }));
      }
    }
    if (live()) {
      const last = state.turns[state.turns.length - 1];
      if (last && last.role === "assistant" && !last.content && !last.answer && !last.error) {
        patchLast((t) => ({ ...t, error: "The service ended the reply without an answer." }));
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError" && live()) {
      patchLast((t) => ({ ...t, error: (e as Error).message || "The request did not reach the server." }));
    }
  } finally {
    if (live()) {
      controller = null;
      set({ busy: false }, false);
    }
  }
}

function withCards(turnIndex: number, fn: (cards: TurnCard[]) => TurnCard[]): void {
  const t = state.turns[turnIndex];
  if (!t) return;
  const turns = state.turns.slice();
  turns[turnIndex] = { ...t, cards: fn(t.cards ?? []) };
  set({ turns });
}

/** The conversation and what can be done with it; every caller in the tab shares one. */
export function useAssistant(): AssistantChat {
  const s = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const pathname = usePathname() || "/";
  const title = pageFor(pathname).info.title;

  useEffect(() => {
    check();
  }, []);

  const cannot = cannotOf(s.availability);

  const ask = useCallback(
    (text: string) => {
      if (state.busy || cannotOf(state.availability) || !text.trim()) return;
      void send(state.turns, text, { path: pathname, title });
    },
    [pathname, title],
  );

  const retry = useCallback(() => {
    if (state.busy || cannotOf(state.availability)) return;
    const turns = state.turns;
    let idx = -1;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === "user") {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;
    void send(turns.slice(0, idx), turns[idx].content, { path: pathname, title });
  }, [pathname, title]);

  const reset = useCallback(() => {
    controller?.abort();
    controller = null;
    set({ turns: [], busy: false });
  }, []);

  const openCard = useCallback((turnIndex: number, href: string, label?: string) => {
    if (typeof href !== "string" || !href) return;
    withCards(turnIndex, (cards) => (cards.some((c) => c.href === href) ? cards : [...cards, label ? { href, label } : { href }]));
  }, []);

  const closeCard = useCallback((turnIndex: number, href: string) => {
    withCards(turnIndex, (cards) => cards.filter((c) => c.href !== href));
  }, []);

  return useMemo(
    () => ({ turns: s.turns, busy: s.busy, availability: s.availability, cannot, ask, retry, reset, openCard, closeCard }),
    [s, cannot, ask, retry, reset, openCard, closeCard],
  );
}
