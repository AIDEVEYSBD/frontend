"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Status } from "./ui";
import { EmptyState, QuietNote } from "./overlays";
import { QUIET } from "@/lib/quiet";
import { PageHeader } from "./section";
import { usePageFacts } from "./assistant";
import { ChatPane } from "./chat-pane";
import { WorkloadChat } from "./chat-workload";
import { listApplications, type Application } from "@/lib/api/l4";
import { useSession } from "@/lib/use-session";

/**
 * Chat (feature 2.3): two things a person can talk to.
 *
 * The chatbots registered as applications on this deployment, read from the
 * applications door as the Applications page reads it. The chat door admits
 * a signed-in session with `run` as well as the application's own key, so a
 * chatbot is tried here as it is governed (components/chat-pane.tsx): its
 * registered prompt, its model, its screening, its limits, every turn
 * journalled under the person's name.
 *
 * And a security workload, asked to do something in plain words
 * (components/chat-workload.tsx), which is ahead of its door.
 *
 * The "Ask" drawer on every page is a third thing and not this: it answers
 * questions about the console itself.
 */

function ChatBody() {
  const params = useSearchParams();
  const router = useRouter();
  const { session } = useSession();
  const [apps, setApps] = useState<Application[] | null>(null);
  const [error, setError] = useState("");
  const wanted = params.get("app") ?? "";

  const load = useCallback(() => {
    listApplications()
      .then((rows) => {
        setApps(rows);
        setError("");
      })
      .catch((e: Error) => {
        setApps([]);
        setError(e.message);
      });
  }, []);
  useEffect(load, [load]);

  // The chat door serves registered chatbots only; a RAG application answers through the retrieval door.
  const chatbots = (apps ?? []).filter((a) => a.class === "chatbot" && a.source === "application");
  const rag = (apps ?? []).filter((a) => a.class === "rag").length;
  const selected = chatbots.find((a) => a.id === wanted) ?? chatbots[0] ?? null;
  const me = session ? session.email || session.sub : "";

  usePageFacts({ chatbots: apps ? chatbots.length : "loading", selected: selected?.id ?? null });

  const pick = (id: string) => router.replace(`/chat?app=${encodeURIComponent(id)}`, { scroll: false });

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <PageHeader title="Chat">
        Talk to a chatbot registered on this deployment, as it is governed: its registered system prompt, its model, its screening and its limits apply, and every turn is journalled under your name. Below, ask a security workload
        to do something in plain words.
      </PageHeader>

      {/* Quiet (lib/quiet.ts): the register was not read. One note, then the page as it is laid out, empty. */}
      {error && QUIET && (
        <>
          <QuietNote />
          <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[264px_minmax(0,1fr)]">
            <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
              <div data-hue="blue" className="flex items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
                <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Chatbots</span>
              </div>
              <p className="px-4 py-4 text-[11.5px] leading-[1.5] text-faint">Chatbots registered on the Applications page are listed here to talk to.</p>
            </section>
            <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
              <div data-hue="blue" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-raise/55 px-4 py-2.5">
                <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Conversation</span>
                <span className="text-[11px] leading-[1.55] text-faint">with the chatbot picked on the left, as it is governed</span>
                <span className="grow" />
                <Button size="sm" variant="solid" tone="neutral" href="/applications">
                  Open Applications
                </Button>
              </div>
              <div className="grid min-w-0 lg:grid-cols-[240px_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col border-b border-line lg:border-r lg:border-b-0">
                  <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                    <span className="text-[12px] font-semibold text-fg">Conversations</span>
                    <span className="grow" />
                    <Button size="sm" variant="solid" tone="neutral" disabled>
                      New
                    </Button>
                  </div>
                  <span className="px-3 py-3 text-[11.5px] leading-[1.5] text-faint">Earlier conversations with the chatbot are listed here.</span>
                </div>
                <div className="flex min-w-0 flex-col">
                  <p className="min-h-[180px] px-4 py-4 text-[11.5px] leading-[1.5] text-faint">Each turn is shown here with its model, its tokens and the controls that screened it.</p>
                  <div className="flex items-end gap-2 border-t border-line p-3">
                    <textarea rows={2} disabled aria-label="Message" placeholder="Write a message" className="min-w-0 grow resize-none rounded-md border border-line-strong bg-raise px-3 py-2 text-[13px] text-fg placeholder:text-faint" />
                    <Button size="md" variant="solid" tone="ink" disabled>
                      Send
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </>
      )}
      {error && !QUIET && <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">The applications register could not be read: {error}</p>}

      {apps === null && <p className="rounded-md border border-line bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-faint">Reading the applications register…</p>}

      {apps !== null && !error && chatbots.length === 0 && (
        <EmptyState
          title="No chatbot is registered on this deployment"
          detail="A chatbot is registered on the Applications page with its system prompt and its policy. Once one is there, it can be talked to here."
          action={
            <Button size="sm" variant="solid" tone="ink" href="/applications">
              Open Applications
            </Button>
          }
        />
      )}

      {chatbots.length > 0 && selected && (
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[264px_minmax(0,1fr)]">
          <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            <div data-hue="blue" className="flex items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
              <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Chatbots</span>
              <span className="tnum text-[11px] text-faint">{chatbots.length}</span>
            </div>
            <div className="flex max-h-[240px] flex-col overflow-y-auto xl:max-h-[560px]">
              {chatbots.map((a) => {
                const on = a.id === selected.id;
                const model = a.policy.model || a.policy.models[0] || "";
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-current={on || undefined}
                    onClick={() => pick(a.id)}
                    className={`focusable flex cursor-pointer flex-col gap-0.5 border-b border-line px-4 py-2.5 text-left last:border-0 ${on ? "bg-raise/80" : "hover:bg-raise/50"}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-[12px] font-medium text-fg">{a.name}</span>
                      <span className="grow" />
                      {a.blocked ? <Status tone="err">blocked</Status> : <Status tone="ok">admitted</Status>}
                    </span>
                    <span className="truncate font-mono text-[10.5px] text-faint">{a.id}</span>
                    <span className="truncate text-[10.5px] text-faint">
                      {model || "default model"}
                      {a.owner ? ` · ${a.owner}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="border-t border-line px-4 py-2 text-[10.5px] leading-[1.5] text-ghost">
              Chatbots on the applications register.{rag > 0 ? ` The ${rag} RAG application${rag === 1 ? "" : "s"} there answer${rag === 1 ? "s" : ""} through the retrieval door, not here.` : ""}
            </p>
          </section>

          {/* Keyed by chatbot: another chatbot is another conversation. */}
          <ChatPane key={selected.id} app={selected} me={me} />
        </div>
      )}

      <WorkloadChat />
    </div>
  );
}

export function ChatView() {
  return (
    <Suspense>
      <ChatBody />
    </Suspense>
  );
}
