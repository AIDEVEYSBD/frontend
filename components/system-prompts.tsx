"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Button, Mono, Tag } from "./ui";
import { Field, Textarea } from "./forms";
import { DigestChip } from "./digest-chip";
import { Skeleton } from "./loaders";
import { leakWindowLine, setSystemPrompt, systemPrompts, type Application, type PromptHistory } from "@/lib/api/l4";

/**
 * A registered application's system prompt, version by version.
 *
 * The gateway injects the registered prompt, and every change to it is a new
 * version signed by whoever made it (`GET /api/applications/{id}/system-prompts`).
 * A version retired recently is still checked for leaks: a response that
 * echoes yesterday's instructions is refused like one that echoes today's,
 * for the window the backend states. Changing the prompt here is
 * `PATCH /api/applications` with the prompt alone, and the answer names the
 * version it recorded.
 */

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "");

export function SystemPromptPanel({ app, onApplication }: { app: Application; onApplication: (a: Application) => void }) {
  // undefined: reading; null: the row has no prompt history (not a registered chatbot or RAG app).
  const [history, setHistory] = useState<PromptHistory | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState("");

  const load = useCallback(() => {
    systemPrompts(app.id)
      .then((h) => {
        setHistory(h);
        setError("");
      })
      .catch((e: Error) => {
        setHistory((cur) => (cur === undefined ? null : cur));
        setError(e.message);
      });
  }, [app.id]);
  useEffect(() => {
    load();
  }, [load]);

  const record = async () => {
    setBusy(true);
    setError("");
    try {
      const { application, recorded } = await setSystemPrompt(app.id, draft.trim());
      onApplication(application);
      setReceipt(recorded ? `Recorded as version ${recorded.version}${recorded.set_by ? `, signed ${recorded.set_by}` : ""}.` : "Unchanged: the text is the same as the current version, so no version was recorded.");
      setEditing(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const current = history?.versions.find((v) => v.current) ?? null;

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div className="flex w-full flex-wrap items-start gap-3 border-b border-line bg-raise/55 px-4 py-2.5">
        <span className="text-[12.5px] font-semibold tracking-[-0.005em]">System prompt</span>
        <span className="text-[11px] leading-[1.55] text-faint">
          {history ? `${history.count} version${history.count === 1 ? "" : "s"} · every change is a new version, signed by whoever made it` : "the prompt the gateway injects, version by version"}
        </span>
        <span className="grow" />
        {history && !editing && (
          <Button
            size="sm"
            variant="solid"
            tone="ink"
            permission="configure"
            onClick={() => {
              setDraft(current?.prompt ?? app.policy.system_prompt);
              setReceipt("");
              setEditing(true);
            }}
          >
            Change the prompt
          </Button>
        )}
      </div>

      {history === undefined && (
        <div className="p-4">
          <Skeleton lines={3} />
        </div>
      )}
      {history === null && (
        <p className="px-4 py-3 text-[11.5px] leading-[1.55] text-faint">
          {error || "Only a registered chatbot or RAG application has a system prompt the gateway injects."}
        </p>
      )}

      {history && (
        <>
          <p className="border-b border-line px-4 py-2.5 text-[11.5px] leading-[1.55] text-dim" title={history.leak_check.says}>
            <span className="font-medium text-fg">Leak check · </span>
            {leakWindowLine(history.leak_check)} A hit is refused under block and flagged under flag; a cleared prompt guards nothing.
          </p>

          {editing && (
            <div className="flex flex-col gap-3 border-b border-line px-4 py-3">
              <Field label="New system prompt" hint="Recorded as the next version under your name. Leave it empty to clear the prompt; the version it retires stays under the leak check for the window above.">
                <Textarea rows={5} value={draft} onChange={setDraft} disabled={busy} />
              </Field>
              <span className="flex items-center gap-2">
                <Button size="sm" variant="solid" tone="ink" permission="configure" loading={busy} disabled={draft.trim() === (current?.prompt ?? "").trim()} onClick={record}>
                  Record version {(history.versions[0]?.version ?? 0) + 1}
                </Button>
                <Button size="sm" variant="solid" tone="err" disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </span>
            </div>
          )}
          {receipt && <p className="border-b border-line px-4 py-2 text-[11.5px] text-ok">{receipt}</p>}
          {error && <p className="border-b border-line px-4 py-2 text-[11.5px] text-err">{error}</p>}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead className="bg-surface">
                <tr className="border-b border-line text-left text-[10.5px] text-faint">
                  <th className="px-4 py-2 font-medium">Version</th>
                  <th className="px-4 py-2 font-medium">Set by</th>
                  <th className="px-4 py-2 font-medium">Set</th>
                  <th className="px-4 py-2 font-medium">Retired</th>
                  <th className="px-4 py-2 text-right font-medium">Chars</th>
                  <th className="px-4 py-2 font-medium">Leak check</th>
                  <th className="px-4 py-2 font-medium">Digest</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {history.versions.map((v) => (
                  <Fragment key={v.id}>
                    <tr className="border-b border-line align-top last:border-0">
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-1.5">
                          <Mono className="text-[11px] text-fg">v{v.version}</Mono>
                          {v.current && <Tag tone="ok">current</Tag>}
                          {v.adopted && <Tag>adopted</Tag>}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-dim">{v.set_by || <span className="text-ghost">not recorded (registered before versions were kept)</span>}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-dim">{when(v.set_at)}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-dim">{v.retired_at ? when(v.retired_at) : <span className="text-ghost">—</span>}</td>
                      <td className="tnum px-4 py-2 text-right text-dim">{v.chars ? v.chars.toLocaleString("en-GB") : <span className="text-ghost">empty</span>}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{v.guarded ? <span className="text-ok">checked</span> : <span className="text-ghost">{v.chars ? "past the window" : "guards nothing"}</span>}</td>
                      <td className="px-4 py-2">
                        <DigestChip digest={v.digest} label={`Version ${v.version} digest`} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        {v.prompt && (
                          <Button size="sm" variant="quiet" onClick={() => setShown((s) => (s === v.id ? null : v.id))}>
                            {shown === v.id ? "Hide" : "Show"}
                          </Button>
                        )}
                      </td>
                    </tr>
                    {shown === v.id && (
                      <tr className="border-b border-line">
                        <td colSpan={8} className="px-4 pb-3">
                          <pre className="max-h-56 overflow-auto rounded-sm border border-line bg-canvas px-3 py-2 font-mono text-[11px] leading-[1.55] whitespace-pre-wrap text-mist">{v.prompt}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {history.versions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-4 text-center text-faint">
                      No system prompt has been registered; the application sends its own, and the gateway has nothing to guard.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
