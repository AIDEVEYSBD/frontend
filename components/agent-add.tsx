"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { agentHref } from "@/lib/agent-link";
import { DrillModal } from "./drill";
import { Button } from "./ui";

/**
 * Adding an agent to this deployment. An agent is not designed in the
 * console: it arrives as a definition document, the JSON file its author
 * hands over. This takes that file (or its pasted text), sends it to
 * `POST /api/agents`, and shows every problem the platform finds in it. A
 * document that names an agent already here is saved as its next version.
 */
export function AddAgent({ onSaved }: { onSaved?: () => void }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const close = () => {
    setOpen(false);
    setText("");
    setName("");
    setProblems([]);
  };

  const read = async (f: File | undefined) => {
    if (!f) return;
    setName(f.name);
    setProblems([]);
    setText(await f.text());
  };

  const save = async () => {
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch (e) {
      setProblems([`This is not valid JSON: ${(e as Error).message}`]);
      return;
    }
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      setProblems(["A definition is one JSON object."]);
      return;
    }
    setBusy(true);
    setProblems([]);
    try {
      const res = await fetch("/api/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec: document }) });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string; problems?: string[] };
      if (!res.ok || !body.id) {
        setProblems(body.problems?.length ? body.problems : [body.error || `The platform answered ${res.status}.`]);
        return;
      }
      onSaved?.();
      close();
      router.push(agentHref(body.id));
    } catch {
      setProblems(["The platform could not be reached."]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="solid" tone="ink" permission="deploy" onClick={() => setOpen(true)}>
        Add an agent
      </Button>
      {open && (
        <DrillModal
          title="Add an agent"
          subtitle="An agent arrives as a definition document: the JSON file its author hands over. It is checked before anything is saved; a part of it the platform does not carry out yet is listed on the agent's page, and stops a deploy and a run. A document that names an agent already here is saved as its next version."
          onClose={close}
          actions={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="solid" tone="err" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" variant="solid" tone="ink" onClick={save} loading={busy} disabled={!text.trim()} permission="deploy">
                Check and save
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void read(e.target.files?.[0])} />
              <Button size="sm" variant="solid" tone="neutral" onClick={() => file.current?.click()} disabled={busy}>
                Choose a file
              </Button>
              <span className="text-[12px] text-faint">{name || "or paste the document below"}</span>
            </div>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setProblems([]);
              }}
              spellCheck={false}
              rows={16}
              placeholder='{ "apiVersion": "agentfactory/v1", "kind": "AgentSystem", "metadata": { "id": "…", "name": "…" }, "spec": { … } }'
              className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 font-mono text-[12px] leading-[1.55] text-fg outline-none placeholder:text-faint focus:border-line-strong"
            />
            {problems.length > 0 && (
              <div className="rounded-md border border-err/40 bg-surface px-3 py-2">
                <p className="text-[12px] font-medium text-err">{problems.length === 1 ? "The document was not saved." : `The document was not saved: ${problems.length} problems.`}</p>
                <ul className="mt-1 list-disc pl-4 text-[12px] leading-[1.55] text-fg">
                  {problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </DrillModal>
      )}
    </>
  );
}
