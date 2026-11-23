"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Mono, Spinner, Status, Tag } from "./ui";
import { Markdown } from "./markdown";
import { AnswerBlocks } from "./answer-blocks";
import { ControlRef, resolveControl } from "./control-ref";
import { api, errorText, type Schemas } from "@/lib/api/client";
import { getConversation, listConversations, outcomeWords, type Application, type Conversation, type ConversationRow } from "@/lib/api/l4";
import { answerOf, type Answer } from "@/lib/answer-blocks";
import { controlLabel } from "@/lib/guardrails";

/**
 * One chatbot, talked to from the console (agentfactory/applications/chat.py).
 *
 * `POST /api/apps/{id}/chat` takes a person with the `run` permission through
 * exactly the gateway's path: the chatbot's registered prompt, its first
 * model, its data class, rate and budget, the screening of the message and
 * of the reply, the leak check, and a journal row under the person's name.
 * The reply comes whole (chat does not stream), with the screening flags it
 * passed with and what it used and cost; the cost is null when its model has
 * no price set. A refusal names its code, the control that ruled and the
 * completion it is journalled as.
 *
 * A conversation the service keeps is started by a person's first turn and
 * held by that person: only they continue it. Earlier conversations are read
 * from the applications register (`GET /api/applications/{id}/conversations`
 * and `.../{cid}`), masked as journalled. One held by someone else, and one
 * the application named itself through the gateway, are shown and not
 * continued.
 *
 * A chatbot whose policy answers in blocks replies with `answer` beside its
 * text: blocks the model wrote as structured output and the service
 * validated. They are drawn by components/answer-blocks.tsx and marked as the
 * chatbot's own words, not figures from the platform's records. A choice or a
 * follow-up question in them is sent as the next message. An answer whose
 * blocks did not validate is refused (answer_invalid) and asked for once more;
 * the replay shows both.
 */

type ChatReply = Schemas["ChatReply"];

/** A refusal from chat, with what it named. */
export interface ChatRefusal {
  status: number;
  message: string;
  code: string;
  control: string;
  conversation: string;
  completion: string;
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
      refusal: { status: response.status, message: errorText(error, response), code: str(e.code), control: str(e.control), conversation: str(e.conversation), completion: str(e.completion) },
    };
  } catch (e) {
    return { ok: false, refusal: { status: 0, message: (e as Error).message || "the request did not reach the server", code: "", control: "", conversation: "", completion: "" } };
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
  /** Null when its model has no price set. */
  cost: number | null;
  latency_ms: number | null;
  /** The completion the turn is journalled as. */
  completion: string;
  /** Screener verdicts that let the turn through (`flag`). */
  flags: string[];
  refusal: { title: string; message: string; control: string } | null;
  /** Read from the record, masked; not typed in this window. */
  recorded: boolean;
  /** The answer in blocks, for a chatbot that answers in blocks; null for a text reply. */
  answer: Answer | null;
}

/** What a refusal is, in a few words: by its code, else by its status. */
function refusalTitle(r: Pick<ChatRefusal, "status" | "code">): string {
  if (r.code) return `Refused: ${outcomeWords(r.code)}`;
  if (r.status === 409) return "Not a chatbot";
  if (r.status === 404) return "Not on the register";
  if (r.status === 403) return "Not permitted";
  if (r.status === 0) return "The request did not arrive";
  return "Refused";
}

/** The exchanges of a recorded conversation: per completion, the message that asked and the answer journalled for it. */
function exchangesOf(c: Conversation): Exchange[] {
  const out: Exchange[] = [];
  const groups = new Map<string, Conversation["turns"]>();
  for (const t of c.turns) groups.set(t.completion, [...(groups.get(t.completion) ?? []), t]);
  for (const [key, turns] of groups) {
    const answer = turns[turns.length - 1];
    // The completion's turns are what the caller sent: for a person's chat, the new message alone.
    const asked = [...turns.slice(0, -1)].reverse().find((t) => t.role === "user");
    if (!answer || answer.role !== "assistant") continue;
    out.push({
      key,
      question: asked?.content ?? "",
      at: answer.at,
      state: answer.refused ? "refused" : "answered",
      reply: answer.content,
      model: answer.model,
      tokens: answer.tokens,
      cost: answer.cost,
      latency_ms: answer.latency_ms,
      completion: answer.completion,
      flags: !answer.refused && answer.screened ? [answer.screened.control] : [],
      refusal: answer.refused ? { title: refusalTitle({ status: 0, code: answer.outcome }), message: answer.reason, control: answer.screened?.control ?? "" } : null,
      recorded: true,
      answer: answer.answer,
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

const money = (c: number) => (c === 0 ? "$0.00" : c < 0.01 ? `$${c.toFixed(6).replace(/0+$/, "")}` : c < 100 ? `$${c.toFixed(2)}` : `$${Math.round(c).toLocaleString("en-GB")}`);
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

/* ═══════════════════ one exchange ═══════════════════ */

function ExchangeView({ x, name, asker, onSend, busy, last }: { x: Exchange; name: string; /** Who asked: "You", or whoever the record names. */ asker: string; /** Sends a choice or a follow-up as the next message; null when this conversation is not continued here. */ onSend: ((text: string) => void) | null; busy: boolean; last: boolean }) {
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
            Waiting for the reply. It arrives whole: chat does not stream.
          </div>
        )}
        {x.state === "answered" && (
          <div className="min-w-0 rounded-md border border-line bg-surface px-3 py-2 text-[13px] leading-[1.6] break-words text-fg">
            {x.reply.trim() ? <Markdown text={x.reply} /> : <span className="text-ghost">The reply was empty.</span>}
          </div>
        )}
        {x.state === "answered" && x.answer && (
          <AnswerBlocks answer={x.answer} origin={{ kind: "chatbot", name }} onSend={(t) => onSend?.(t)} busy={busy || !onSend} followups={last && Boolean(onSend)} />
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
            {x.state === "answered" && <span className="tnum">{x.cost !== null ? money(x.cost) : "no price set"}</span>}
            {x.latency_ms !== null && x.latency_ms > 0 && <span className="tnum">{duration(x.latency_ms)}</span>}
            {x.flags.map((c) => (
              <span key={c} className="inline-flex flex-wrap items-center gap-1.5">
                <Tag tone="warn">Flagged, let through</Tag>
                <Control control={c} />
              </span>
            ))}
            {x.completion && <Mono className="text-[10px] text-ghost">{x.completion}</Mono>}
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════ the pane ═══════════════════ */

const MESSAGE_CAP = 50_000;

export function ChatPane({ app, me }: { app: Application; /** The person signed in: their email, else their subject, as a kept conversation names its holder. */ me: string }) {
  const [now] = useState(() => Date.now());
  const [convs, setConvs] = useState<ConversationRow[] | null>(null);
  const [convError, setConvError] = useState("");
  const [cid, setCid] = useState<string | null>(null);
  /** The conversation open: whether the service keeps it (a person's chat), and who holds it. */
  const [held, setHeld] = useState<{ kept: boolean; holder: string }>({ kept: true, holder: "" });
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
    setHeld({ kept: true, holder: "" });
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
      setHeld({ kept: c.conversation.kept, holder: c.conversation.principal });
      setExchanges(exchangesOf(c));
    } catch (e) {
      setOpenError((e as Error).message);
    } finally {
      setOpening("");
    }
  };

  const mine = (holder: string) => Boolean(me) && holder.toLowerCase() === me.toLowerCase();
  // A conversation the application named is not continued here; nor is one another person holds.
  const named = cid !== null && !held.kept;
  const foreign = cid !== null && held.kept && !mine(held.holder);
  const tooLong = draft.length > MESSAGE_CAP;
  const cannot = app.blocked
    ? "This chatbot is blocked: the gateway refuses every call until the block is lifted."
    : named
      ? "This conversation was named by the application through the gateway. It is shown as recorded and is not continued from here."
      : foreign
        ? `This conversation is held by ${held.holder || "a person the record does not name"}. It is shown as recorded and is not continued by anyone else.`
        : "";

  const send = async (typed?: string) => {
    const message = (typed ?? draft).trim();
    if (!message || sending || message.length > MESSAGE_CAP || cannot) return;
    const key = `live-${++seq.current}`;
    if (typed === undefined) setDraft("");
    setOpenError("");
    setSending(true);
    setExchanges((xs) => [...xs, { key, question: message, at: new Date().toISOString(), state: "waiting", reply: "", model: "", tokens: null, cost: null, latency_ms: null, completion: "", flags: [], refusal: null, recorded: false, answer: null }]);
    const answer = await sendChat(app.id, message, cid);
    const patch = (p: Partial<Exchange>) => setExchanges((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));
    if (answer.ok) {
      const r = answer.reply;
      const usage = r.usage as Partial<ChatReply["usage"]> & { cost?: number | null };
      setCid(r.conversation);
      setHeld({ kept: true, holder: r.principal || me });
      patch({
        state: "answered",
        reply: r.reply,
        model: usage.model ?? "",
        tokens: usage.tokens ? { in: usage.tokens.in, out: usage.tokens.out } : null,
        cost: typeof usage.cost === "number" ? usage.cost : null,
        latency_ms: typeof usage.latency_ms === "number" ? usage.latency_ms : null,
        completion: usage.completion ?? "",
        flags: [...new Set((r.screened ?? []).map((v) => str(v.control)).filter(Boolean))],
        // `answer` is beside the reply only for a chatbot that answers in blocks; the generated schema predates it.
        answer: answerOf((r as unknown as Record<string, unknown>).answer),
      });
    } else {
      const r = answer.refusal;
      // A refusal journalled in a conversation still belongs to it.
      if (r.conversation) {
        setCid(r.conversation);
        setHeld((h) => ({ kept: true, holder: h.holder || me }));
      }
      patch({ state: "refused", completion: r.completion, refusal: { title: refusalTitle(r), message: r.message, control: r.control } });
    }
    setSending(false);
    readConversations();
  };

  const model = app.policy.models[0] ?? "";

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div data-hue="blue" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-raise/55 px-4 py-2.5">
        <span className="text-[12.5px] font-semibold tracking-[-0.005em]">{app.name}</span>
        <Mono className="text-[10.5px] text-faint">{app.id}</Mono>
        {app.blocked ? <Status tone="err">blocked</Status> : <Status tone="ok">admitted</Status>}
        <span className="text-[11px] leading-[1.55] text-faint">
          model {model} · {app.policy.data_class} data · {app.policy.system_prompt ? "registered system prompt" : "no registered system prompt"} · answers in {app.policy.answers === "blocks" ? "text and blocks" : "text"} · screening refuses a block and records a flag
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
            {convError && <span className="px-3 py-3 text-[11.5px] leading-[1.5] text-err">{convError}</span>}
            {convs?.length === 0 && !convError && <span className="px-3 py-3 text-[11.5px] leading-[1.5] text-faint">No conversation is on the record for this chatbot yet.</span>}
            {(convs ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => void open(c)}
                aria-current={cid === c.id || undefined}
                className={`focusable flex cursor-pointer flex-col gap-0.5 border-b border-line px-3 py-2 text-left last:border-0 ${cid === c.id ? "bg-raise/80" : "hover:bg-raise/50"}`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium text-fg">{c.kept ? (mine(c.principal) ? "You" : c.principal || "a person not recorded") : "named by the application"}</span>
                  <span className="grow" />
                  <span className="shrink-0 text-[10.5px] text-faint">{opening === c.id ? "opening…" : ago(c.last, now)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-x-2 text-[10.5px] text-faint">
                  <span className="tnum">
                    {c.completions} turn{c.completions === 1 ? "" : "s"}
                  </span>
                  {c.refusals > 0 && <span className="tnum text-err">{c.refusals} refused</span>}
                  <span className="tnum">{c.cost !== null ? money(c.cost) : c.unpriced ? "no price set" : ""}</span>
                  {c.cost !== null && c.unpriced > 0 && <span className="tnum">+ {c.unpriced} unpriced</span>}
                </span>
                <span className="truncate font-mono text-[10px] text-ghost">{c.id}</span>
              </button>
            ))}
          </div>
          <p className="border-t border-line px-3 py-2 text-[10.5px] leading-[1.5] text-ghost">Everyone&rsquo;s conversations with this chatbot, newest first, replayed with secrets and personal data masked.</p>
        </div>

        {/* ── the conversation ── */}
        <div className="flex min-w-0 flex-col">
          <div ref={scroller} className="flex h-[min(52vh,520px)] min-h-[260px] flex-col gap-4 overflow-y-auto px-4 py-4">
            {openError && <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">{openError}</p>}
            {exchanges.length === 0 && !openError && (
              <div className="m-auto flex max-w-[46ch] flex-col items-center gap-1.5 text-center">
                <span className="text-[13px] font-medium text-fg">A new conversation</span>
                <span className="text-[12.5px] leading-[1.55] text-dim">
                  What you send goes to the chatbot as it is registered: its system prompt, its first model, its data class, its rate and budget, and its screening. Every turn is journalled under your name, and only you can continue the conversation.
                </span>
              </div>
            )}
            {cid && exchanges.some((x) => x.recorded) && (
              <span className="self-center text-[10.5px] text-ghost">
                Conversation <span className="font-mono">{cid}</span>, as recorded: secrets and personal data are masked.
              </span>
            )}
            {exchanges.map((x, i) => (
              <ExchangeView
                key={x.key}
                x={x}
                name={app.name}
                asker={x.recorded && (named || foreign) ? (named ? "the application" : held.holder || "a person the record does not name") : "You"}
                onSend={cannot ? null : (t) => void send(t)}
                busy={sending}
                last={i === exchanges.length - 1}
              />
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
