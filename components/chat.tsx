"use client";
import { Failure, NotConnected } from "./pending";
import { notBuiltDoorOf } from "@/lib/api/client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Status } from "./ui";
import { EmptyState } from "./overlays";
import { PageHeader } from "./section";
import { usePageFacts } from "./assistant";
import { ChatPane } from "./chat-pane";
import { WorkloadChat } from "./chat-workload";
import { listApplications, type Application } from "@/lib/api/l4";
import { useSession } from "@/lib/use-session";

/**
 * Chat (feature 2.3): two things a person can talk to.
 *
 * The chatbots registered on this deployment, read from the applications
 * register as the Applications page reads it. A person with `run` talks to
 * one through `POST /api/apps/{id}/chat`, which takes exactly the gateway's
 * path (components/chat-pane.tsx): its registered prompt, its first model,
 * its data class, rate and budget, its screening, every turn journalled
 * under the person's name.
 *
 * And a security workload, asked to do something in plain words
 * (components/chat-workload.tsx).
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

  // Chat talks to registered chatbots only; a RAG app calls the gateway with its own key.
  const chatbots = (apps ?? []).filter((a) => a.class === "chatbot" && a.source === "application");
  const rag = (apps ?? []).filter((a) => a.class === "rag").length;
  const selected = chatbots.find((a) => a.id === wanted) ?? chatbots[0] ?? null;
  const me = session ? session.email || session.sub : "";

  usePageFacts({ chatbots: apps ? chatbots.length : "loading", selected: selected?.id ?? null });

  const pick = (id: string) => router.replace(`/chat?app=${encodeURIComponent(id)}`, { scroll: false });

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <PageHeader title="Chat">
        Two ways to talk to the platform: a chatbot from the applications register, and a request to a security workload in plain words. Each part below says whether this deployment offers it.
      </PageHeader>

      {/* The applications register is built in a later phase: its 501 reads as "not built", never as an empty register. */}
      {error && notBuiltDoorOf(error) ? (
        <NotConnected door={{ method: "GET", path: notBuiltDoorOf(error)?.path ?? "/api/applications" }} compact title="Chatbots: not built yet">
          The chatbots registered as applications on this deployment, to talk to here under their registered prompt, model, screening and limits.
        </NotConnected>
      ) : error ? (
        <Failure what="The applications register could not be read" message={error} />
      ) : null}

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
                const model = a.policy.models[0] ?? "";
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
                      {model} · {a.policy.data_class}
                      {a.owner ? ` · ${a.owner}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="border-t border-line px-4 py-2 text-[10.5px] leading-[1.5] text-ghost">
              Chatbots on the applications register.{rag > 0 ? ` The ${rag} RAG app${rag === 1 ? "" : "s"} there call${rag === 1 ? "s" : ""} the gateway with ${rag === 1 ? "its" : "their"} own key and ${rag === 1 ? "is" : "are"} not talked to here.` : ""}
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
