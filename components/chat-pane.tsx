"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Mono, Spinner, Status, Tag } from "./ui";
import { Markdown } from "./markdown";
import { ControlRef, resolveControl } from "./control-ref";
import { api, errorText, type Schemas } from "@/lib/api/client";
import { QUIET } from "@/lib/quiet";
import { QuietNote } from "./overlays";
import { getConversation, listConversations, type Application, type Conversation, type ConversationRow } from "@/lib/api/l4";
import { controlLabel } from "@/lib/guardrails";

/**
 * One chatbot, tried from the console (feature 2.3; backend/app/chat.py).
 *
 * `POST /api/apps/{id}/chat` admits the application's own key or a signed-in
 * session with the `run` permission, so a person may talk to a chatbot
 * registered here without holding its key. The door injects the registered
 * system prompt, uses the policy's model, screens the message and the reply
 * as the gateway does and journals the turn. It answers the whole reply at
 * once (it does not stream), with the screener's verdicts and the usage; a
 * refusal names the control that ruled and the run it is recorded on. A
 * chatbot returns no citations: retrieval belongs to RAG applications,
 * which answer through the retrieval door.
 *
 * The door keeps the conversation (`conversations`, `messages`) and takes
 * its id back to continue it. Earlier conversations are read from the
 * applications door (`GET /api/applications/{id}/conversations` and
 * `.../{cid}`, the `view` permission), which replays them redacted. A
 * conversation is continued here only by the principal who holds it: the
 * door would otherwise put this person's name on someone else's record.
 */

type ChatReply = Schemas["ChatReply"];

/** A refusal from the chat door, with what it named. */
export interface ChatRefusal {
  status: number;
  message: string;
  code: string;
  control: string;
  /** `user` when the message was screened; "" otherwise. */
  where: string;
  run: string;
  conversation: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** `POST /api/apps/{id}/chat`: one turn. Never throws. */
export async function sendChat(app: string, message: string, conversation: string | null): Promise<{ ok: true; reply: ChatReply } | { ok: false; refusal: ChatRefusal }> {
  try {
    const { data, error, response } = await api.POST("/api/apps/{app_id}/chat", { params: { path: { app_id: app } }, body: conversation ? { message, conversation } : { message } });
    if (data) return { ok: true, reply: data };
    const e = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
    return {
      ok: false,
      refusal: { status: response.status, message: errorText(error, response), code: str(e.code), control: str(e.control), where: str(e.where), run: str(e.run), conversation: str(e.conversation) },
    };
  } catch (e) {
    return { ok: false, refusal: { status: 0, message: (e as Error).message || "the request did not reach the server", code: "", control: "", where: "", run: "", conversation: "" } };
  }
}

/** One exchange: what was asked, and what came back for it. */
interface Exchange {
  key: string;
  question: string;
  at: string;
  state: "waiting" | "answered" | "refused";
  reply: string;
  model: string;
  tokens: { in: number; out: number } | null;
  cost: number | null;
  estimated: boolean;
  latency_ms: number | null;
  run: string;
  /** Screener verdicts that let the turn through (`flag`). */
  flags: string[];
  refusal: { title: string; message: string; control: string } | null;
  /** Read from the record, redacted; not typed in this window. */
  recorded: boolean;
}

/** What a refusal is, in a few words, from the door's status and code. */
function refusalTitle(r: Pick<ChatRefusal, "status" | "code" | "where">): string {
  if (r.code === "prompt_screened") return "Message refused by screening";
  if (r.code === "response_screened") return "Reply withheld by screening";
  if (r.code === "system_prompt_leaked") return "Reply withheld: it repeated the registered prompt";
  if (r.status === 429) return "Rate limit reached";
  if (r.status === 402) return "Budget spent";
  if (r.status === 423) return "This chatbot is blocked";
  if (r.status === 403) return "Not permitted";
  if (r.status === 409) return "Not a chatbot";
  if (r.status === 404) return "Not on the register";
  if (r.status === 502 || r.code.startsWith("upstream")) return "The model did not answer";
  if (r.status === 0) return "The request did not arrive";
  return "Refused";
}

const OUTCOME_TITLE: Record<string, string> = {
  screened: "Refused by screening",
  leaked: "Reply withheld: it repeated the registered prompt",
  upstream_error: "The model did not answer",
};

/** The exchanges of a recorded conversation: per completion, the message that asked and the answer journalled for it. */
function exchangesOf(c: Conversation): Exchange[] {
  const out: Exchange[] = [];
  const groups = new Map<string, Conversation["turns"]>();
  for (const t of c.turns) {
    const k = t.entry || `${t.at}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  for (const [key, turns] of groups) {
    const answer = turns[turns.length - 1];
    // The completion's turns are the request as the model saw it: the history, then the new message.
    const asked = [...turns.slice(0, -1)].reverse().find((t) => t.role === "user");
    if (!answer || answer.role !== "assistant") continue;
    // Refused when the gateway says so, when a verdict blocked it, or when the journalled outcome is anything but ok.
    const refused = answer.refused || answer.screened?.action === "block" || Boolean(answer.outcome && answer.outcome !== "ok");
    out.push({
      key,
      question: asked?.content ?? "",
      at: answer.at,
      state: refused ? "refused" : "answered",
      reply: answer.content,
      model: answer.model,
      tokens: answer.tokens,
      cost: answer.cost,
      estimated: false,
      latency_ms: answer.latency_ms,
      run: answer.run,
      flags: !refused && answer.screened ? [answer.screened.control] : [],
      refusal: refused ? { title: OUTCOME_TITLE[answer.outcome] ?? `Refused${answer.outcome ? `: ${answer.outcome.replace(/_/g, " ")}` : ""}`, message: "", control: answer.screened?.control ?? "" } : null,
      recorded: true,
    });
  }
  return out;
}

/* ═══════════════════ small words ═══════════════════ */

function ago(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return iso || "unknown";
  const mins = Math.round((now - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const money = (c: number | null) => (c === null ? "unknown" : c === 0 ? "$0.00" : c < 0.005 ? "<$0.01" : c < 100 ? `$${c.toFixed(2)}` : `$${Math.round(c).toLocaleString("en-GB")}`);
const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`);

/** The control that ruled: its register row when it has one, else its key, in words when the console has them. */
function Control({ control }: { control: string }) {
  if (!control) return null;
  if (resolveControl(control)) return <ControlRef control={control} />;
  const label = controlLabel(control);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {label !== control && <span className="text-[11px] text-dim">{label}</span>}
      <Mono className="text-[10px] text-faint">{control}</Mono>
    </span>
  );
}

function RunLink({ run }: { run: string }) {
  if (!run) return null;
  return (
    <Link href={`/runs?id=${encodeURIComponent(run)}`} className="focusable rounded-sm font-mono text-[10.5px] text-dim underline decoration-line-strong underline-offset-2 hover:decoration-fg">
      {run}
    </Link>
  );
}

/* ═══════════════════ one exchange ═══════════════════ */

function ExchangeView({ x, name, asker }: { x: Exchange; name: string; /** Who asked: "You", or the principal who holds a conversation read from the record. */ asker: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex max-w-[86%] flex-col gap-1 self-end">
        <span className="self-end text-[10.5px] text-faint">{asker}</span>
        <div className="rounded-md bg-raise px-3 py-2 text-[13px] leading-[1.55] break-words whitespace-pre-wrap text-fg">
          {x.question || <span className="text-ghost">The record does not carry the message.</span>}
        </div>
      </div>

      <div className="flex max-w-[92%] min-w-0 flex-col gap-1 self-start">
        <span className="text-[10.5px] text-faint">{name}</span>
        {x.state === "waiting" && (
          <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-dim">
            <Spinner size={13} />
            Waiting for the reply. It arrives whole: this door does not stream.
          </div>
        )}
        {x.state === "answered" && (
          <div className="min-w-0 rounded-md border border-line bg-surface px-3 py-2 text-[13px] leading-[1.6] break-words text-fg">
            {x.reply.trim() ? <Markdown text={x.reply} /> : <span className="text-ghost">The reply was empty.</span>}
          </div>
        )}
        {x.state === "refused" && x.refusal && (
          <div className="relative flex flex-col items-start gap-1.5 overflow-hidden rounded-md border border-err-line bg-surface py-2 pr-3 pl-4">
            <span className="absolute inset-y-0 left-0 w-[3px] bg-err" aria-hidden />
            <Status tone="err">{x.refusal.title}</Status>
            {x.refusal.message && <span className="text-[12.5px] leading-[1.55] break-words text-dim">{x.refusal.message}</span>}
            <Control control={x.refusal.control} />
          </div>
        )}
        {x.state !== "waiting" && (
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-faint">
            {x.model && <Mono className="text-[10.5px] text-faint">{x.model}</Mono>}
            {x.tokens && (
              <span className="tnum">
                {x.tokens.in.toLocaleString("en-GB")} in · {x.tokens.out.toLocaleString("en-GB")} out
              </span>
            )}
            {x.cost !== null && (x.state === "answered" || x.cost > 0) && (
              <span className="tnum">
                {money(x.cost)}
                {x.estimated ? " estimated" : ""}
              </span>
            )}
            {x.latency_ms !== null && x.latency_ms > 0 && <span className="tnum">{duration(x.latency_ms)}</span>}
            {x.flags.map((c) => (
              <span key={c} className="inline-flex flex-wrap items-center gap-1.5">
                <Tag tone="warn">Flagged, let through</Tag>
                <Control control={c} />
              </span>
            ))}
            {x.run && (
              <span className="inline-flex items-center gap-1">
                on run <RunLink run={x.run} />
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════ the pane ═══════════════════ */

const MESSAGE_CAP = 50_000;

export function ChatPane({ app, me }: { app: Application; /** The principal the door gives this person's turns: their email, else their subject. */ me: string }) {
  const [now] = useState(() => Date.now());
  const [convs, setConvs] = useState<ConversationRow[] | null>(null);
  const [convError, setConvError] = useState("");
  const [cid, setCid] = useState<string | null>(null);
  const [holder, setHolder] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [opening, setOpening] = useState("");
  const [openError, setOpenError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const readConversations = useCallback(() => {
    listConversations(app.id, 50)
      .then((rows) => {
        setConvs(rows);
        setConvError("");
      })
      .catch((e: Error) => {
        setConvs([]);
        setConvError(e.message);
      });
  }, [app.id]);
  useEffect(readConversations, [readConversations]);

  // The newest exchange stays in view.
  const last = exchanges[exchanges.length - 1];
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [exchanges.length, last?.state]);

  const fresh = () => {
    setCid(null);
    setHolder("");
    setExchanges([]);
    setOpenError("");
  };

  const open = async (row: ConversationRow) => {
    if (sending) return;
    setOpening(row.id);
    setOpenError("");
    try {
      const c = await getConversation(app.id, row.id);
      setCid(row.id);
      setHolder(c.conversation.principal || row.principal);
      setExchanges(exchangesOf(c));
    } catch (e) {
      setOpenError((e as Error).message);
    } finally {
      setOpening("");
    }
  };

  // Another person's conversation is read, not continued; so is one whose holder the record does not name.
  const foreign = cid !== null && exchanges.some((x) => x.recorded) && (!holder || !me || holder.toLowerCase() !== me.toLowerCase());
  const tooLong = draft.length > MESSAGE_CAP;
  const cannot = app.blocked ? "This chatbot is blocked by an operator; every door refuses until the block is lifted." : foreign ? `This conversation is held by ${holder || "a principal the record does not name"}. It is shown as recorded and is not continued from here.` : "";

  const send = async () => {
    const message = draft.trim();
    if (!message || sending || tooLong || cannot) return;
    const key = `live-${++seq.current}`;
    setDraft("");
    setOpenError("");
    setSending(true);
    setExchanges((xs) => [...xs, { key, question: message, at: new Date().toISOString(), state: "waiting", reply: "", model: "", tokens: null, cost: null, estimated: false, latency_ms: null, run: "", flags: [], refusal: null, recorded: false }]);
    const answer = await sendChat(app.id, message, cid);
    const patch = (p: Partial<Exchange>) => setExchanges((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));
    if (answer.ok) {
      const r = answer.reply;
      setCid(r.conversation);
      setHolder(r.principal || me);
      patch({
        state: "answered",
        reply: r.reply,
        model: r.usage.model,
        tokens: { in: r.usage.tokens.in, out: r.usage.tokens.out },
        cost: r.usage.cost,
        estimated: r.usage.estimated,
        latency_ms: r.usage.latency_ms,
        run: r.usage.run,
        flags: [...new Set((r.screened ?? []).map((v) => str(v.control)).filter(Boolean))],
      });
    } else {
      const r = answer.refusal;
      // A refusal after the conversation was opened still belongs to it.
      if (r.conversation) {
        setCid(r.conversation);
        setHolder((h) => h || me);
      }
      patch({ state: "refused", run: r.run, refusal: { title: refusalTitle(r), message: r.message, control: r.control } });
    }
    setSending(false);
    readConversations();
  };

  const model = app.policy.model || app.policy.models[0] || "";

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div data-hue="blue" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-raise/55 px-4 py-2.5">
        <span className="text-[12.5px] font-semibold tracking-[-0.005em]">{app.name}</span>
        <Mono className="text-[10.5px] text-faint">{app.id}</Mono>
        {app.blocked ? <Status tone="err">blocked</Status> : <Status tone="ok">admitted</Status>}
        <span className="text-[11px] leading-[1.55] text-faint">
          {model ? `model ${model}` : "the deployment’s default model"} · screening {app.policy.screen === "block" ? "blocks a hit" : "flags a hit and lets it through"} ·{" "}
          {app.policy.system_prompt ? "registered system prompt" : "no registered system prompt"}
        </span>
        <span className="grow" />
        <Button size="sm" variant="solid" tone="neutral" href={`/applications/${encodeURIComponent(app.id)}`}>
          Open the application
        </Button>
      </div>

      <div className="grid min-w-0 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* ── earlier conversations ── */}
        <div className="flex min-w-0 flex-col border-b border-line lg:border-r lg:border-b-0">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <span className="text-[12px] font-semibold text-fg">Conversations</span>
            {convs && <span className="tnum text-[11px] text-faint">{convs.length}</span>}
            <span className="grow" />
            <Button size="sm" variant="solid" tone="neutral" disabled={sending || (cid === null && exchanges.length === 0)} onClick={fresh}>
              New
            </Button>
          </div>
          <div className="flex max-h-[220px] flex-col overflow-y-auto lg:max-h-[520px]">
            {convs === null && <span className="px-3 py-3 text-[11.5px] text-faint">Reading the conversations…</span>}
            {convError && QUIET && (
              <span className="px-3 py-3">
                <QuietNote inline />
              </span>
            )}
            {convError && !QUIET && <span className="px-3 py-3 text-[11.5px] leading-[1.5] text-err">{convError}</span>}
            {convs?.length === 0 && !convError && <span className="px-3 py-3 text-[11.5px] leading-[1.5] text-faint">No conversation is on the record for this chatbot yet.</span>}
            {(convs ?? []).map((c) => {
              const mine = Boolean(me) && c.principal.toLowerCase() === me.toLowerCase();
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void open(c)}
                  aria-current={cid === c.id || undefined}
                  className={`focusable flex cursor-pointer flex-col gap-0.5 border-b border-line px-3 py-2 text-left last:border-0 ${cid === c.id ? "bg-raise/80" : "hover:bg-raise/50"}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] font-medium text-fg">{mine ? "You" : c.principal || "no principal"}</span>
                    <span className="grow" />
                    <span className="shrink-0 text-[10.5px] text-faint">{opening === c.id ? "opening…" : ago(c.last, now)}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 text-[10.5px] text-faint">
                    <span className="tnum">
                      {c.turns} turn{c.turns === 1 ? "" : "s"}
                    </span>
                    {c.refusals > 0 && <span className="tnum text-err">{c.refusals} refused</span>}
                    <span className="tnum">{money(c.cost)}</span>
                  </span>
                  <span className="truncate font-mono text-[10px] text-ghost">{c.id}</span>
                </button>
              );
            })}
          </div>
          <p className="border-t border-line px-3 py-2 text-[10.5px] leading-[1.5] text-ghost">Everyone&rsquo;s conversations with this chatbot, newest first, replayed with secrets and personal data redacted.</p>
        </div>

        {/* ── the conversation ── */}
        <div className="flex min-w-0 flex-col">
          <div ref={scroller} className="flex h-[min(52vh,520px)] min-h-[260px] flex-col gap-4 overflow-y-auto px-4 py-4">
            {openError && QUIET && <QuietNote inline />}
            {openError && !QUIET && <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">{openError}</p>}
            {exchanges.length === 0 && !openError && (
              <div className="m-auto flex max-w-[46ch] flex-col items-center gap-1.5 text-center">
                <span className="text-[13px] font-medium text-fg">A new conversation</span>
                <span className="text-[12.5px] leading-[1.55] text-dim">
                  What you send goes to the chatbot as it is registered: its system prompt, its model, its screening and its limits. Every turn is journalled under your name.
                </span>
              </div>
            )}
            {cid && exchanges.some((x) => x.recorded) && (
              <span className="self-center text-[10.5px] text-ghost">
                Conversation <span className="font-mono">{cid}</span>, as recorded: secrets and personal data are redacted.
              </span>
            )}
            {exchanges.map((x) => (
              <ExchangeView key={x.key} x={x} name={app.name} asker={foreign && x.recorded ? holder || "A principal the record does not name" : "You"} />
            ))}
          </div>

          <form
            className="flex flex-col gap-2 border-t border-line bg-canvas px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              disabled={Boolean(cannot)}
              aria-label={`Message to ${app.name}`}
              aria-invalid={tooLong || undefined}
              className={`w-full resize-y rounded-md border bg-field px-3 py-2 text-[13px] leading-[1.55] text-fg transition-[border-color,box-shadow] duration-100 placeholder:text-ghost focus:outline-none focus-visible:border-fg focus-visible:ring-2 focus-visible:ring-fg/15 disabled:cursor-not-allowed disabled:bg-raise disabled:text-ghost ${tooLong ? "border-err" : "border-line-strong"}`}
            />
            <div className="flex items-start gap-3">
              <span className={`min-w-0 grow pt-1 text-[11.5px] leading-[1.5] ${cannot || tooLong ? "text-warn" : "text-faint"}`}>
                {cannot || (tooLong ? `A message is at most ${MESSAGE_CAP.toLocaleString("en-GB")} characters; this one is ${draft.length.toLocaleString("en-GB")}.` : "Enter sends; Shift and Enter starts a new line.")}
              </span>
              <span className="shrink-0">
                <Button type="submit" size="sm" variant="solid" tone="ink" permission="run" loading={sending} disabled={!draft.trim() || tooLong || Boolean(cannot)}>
                  {sending ? "Waiting…" : "Send"}
                </Button>
              </span>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
