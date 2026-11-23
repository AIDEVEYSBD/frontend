"use client";
import { useDoorOff } from "@/lib/use-doors";
import { Failure } from "./pending";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AUTONOMIES,
  AUTONOMY_LABEL,
  CLASS_LABEL,
  GATEWAY_PATH,
  SNIPPETS,
  activityOf,
  autonomyLabel,
  createApplication,
  patchApplication,
  readRegister,
  type Activity,
  type Application,
  type AnswerMode,
  type ApplicationClass,
  type Autonomy,
  type BudgetPeriod,
  type Minted,
  type Policy,
  type PolicyWire,
} from "@/lib/api/l4";
import { DATA_CLASSES, type DataClass } from "@/lib/api/pending";
import { errorText } from "@/lib/api/client";
import { agentHref } from "@/lib/agent-link";
import { useMachineOrigin, useSession } from "@/lib/use-session";
import { machineAddress, machineLine } from "@/lib/site";
import { GroupHeader } from "./page-tabs";
import { Button, Mono, Status, Tag } from "./ui";
import { Pick } from "./select";
import { Code, CopyButton } from "./code";
import { DrillModal } from "./drill";
import { Checkbox, Field, Input, Textarea } from "./forms";
import { SearchBox } from "./filters";
import { usePageFacts } from "./assistant";

/**
 * The applications register: the chatbots and RAG apps registered here, and
 * the agents deployed here beside them, in one list.
 *
 * A chatbot or RAG app is registered with its policy (the models it may
 * call, its data class, a rate per minute and a budget per period, a
 * chatbot's system prompt, a RAG app's knowledge stores) and gets a key,
 * shown once. It calls models through the gateway with that key, and the
 * gateway holds every call to the policy and journals it. A deployed agent
 * is listed here and governed on the Agents page; its calls are runs.
 *
 * The figures beside a registered application (last seen, cost, controls
 * fired over 30 days) are read from its own metrics and conversations
 * addresses. A cost is null when its calls had no price set, and says so.
 */

const CLASS_TONE: Record<ApplicationClass, "queue" | "ok" | "run" | "warn"> = { chatbot: "queue", rag: "ok", agent: "run", multi_agent: "warn" };

function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const money = (c: number) => (c === 0 ? "$0.00" : c < 0.01 ? `$${c.toFixed(6).replace(/0+$/, "")}` : c < 100 ? `$${c.toFixed(2)}` : `$${Math.round(c).toLocaleString("en-GB")}`);

/** A cost the service answered: a sum, or "no price set" when every call in it was unpriced. Unpriced calls beside a sum are named. */
export function costLine(cost: number | null, unpriced: number): string {
  if (cost === null) return unpriced ? "no price set" : "unknown";
  return unpriced ? `${money(cost)} + ${unpriced} unpriced` : money(cost);
}

/** How a chatbot may answer a person in the console's chat (the policy's `answers`); the choices and what they mean. */
export const ANSWER_OPTIONS: { value: AnswerMode; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "blocks", label: "Text and blocks" },
];
export const ANSWERS_HINT =
  "Text and blocks: the model is asked for an answer of text plus tiles, a table, bars, a chart, steps, links or choices, as structured output through the same gateway path, and the service checks it before it is shown. The blocks are the chatbot's own words. The gateway's OpenAI-compatible addresses answer as they always do.";

/** A policy in one line: data class, models, rate, budget. */
export function policyLine(p: Policy): string {
  const rate = p.rate_per_minute === null ? "no rate limit" : `${p.rate_per_minute}/min`;
  const budget = p.budget ? `${money(p.budget.amount_usd)} a ${p.budget.period}` : "no budget";
  return `${p.data_class} · ${rate} · ${budget}`;
}

/** Read every registered application's activity, a few addresses at a time. */
async function activities(ids: string[], onOne: (id: string, a: Activity) => void): Promise<void> {
  const queue = [...ids];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift()!;
      onOne(id, await activityOf(id));
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
}

export function Applications() {
  const [now] = useState(() => Date.now());
  const [apps, setApps] = useState<Application[] | null>(null);
  const [notBuilt, setNotBuilt] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<Record<string, Activity>>({});
  const [error, setError] = useState("");
  const [cls, setCls] = useState<ApplicationClass | "">("");
  const [q, setQ] = useState("");
  const [connecting, setConnecting] = useState(false);
  const connectDoor = useDoorOff("POST", "/api/applications");
  const [minted, setMinted] = useState<Minted | null>(null);
  const [busy, setBusy] = useState("");
  const machine = useMachineOrigin();
  const gateway = machineAddress(machine, GATEWAY_PATH);

  const load = useCallback(() => {
    readRegister()
      .then(({ rows, notBuilt: nb }) => {
        setApps(rows);
        setNotBuilt(nb);
        setError("");
        // Only a registered application has metrics and conversations; a deployed agent's calls are runs.
        void activities(
          rows.filter((r) => r.source === "application").map((r) => r.id),
          (id, a) => setActivity((prev) => ({ ...prev, [id]: a })),
        );
      })
      .catch((e: Error) => {
        setApps([]);
        setError(e.message);
      });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (apps ?? []).filter((a) => (!cls || a.class === cls) && (!term || a.name.toLowerCase().includes(term) || a.id.toLowerCase().includes(term) || a.owner.toLowerCase().includes(term)));
  }, [apps, cls, q]);

  const registered = (apps ?? []).filter((a) => a.source === "application");
  const count = (c: ApplicationClass) => (apps ?? []).filter((a) => a.class === c).length;
  const blocked = registered.filter((a) => a.blocked).length;
  const known = registered.map((a) => activity[a.id]).filter((a): a is Activity => Boolean(a) && !a.unknown);
  const unread = registered.length - known.length - registered.filter((a) => !activity[a.id]).length;
  const pending = registered.filter((a) => !activity[a.id]).length;
  const fired = known.reduce((s, a) => s + a.controls_fired, 0);
  const priced = known.filter((a) => a.cost !== null);
  const cost = priced.reduce((s, a) => s + (a.cost ?? 0), 0);
  const unpriced = known.reduce((s, a) => s + a.unpriced, 0);
  // The register could not be read: the page says so and counts nothing.
  const off = Boolean(error) && (apps?.length ?? 0) === 0;

  usePageFacts({
    applications: off ? "not read" : apps ? apps.length : "loading",
    byClass: apps ? Object.fromEntries((["chatbot", "rag", "agent", "multi_agent"] as ApplicationClass[]).map((c) => [c, count(c)])) : null,
    blocked,
    controlsFired30d: pending ? "reading" : fired,
    spend30d: pending ? "reading" : { priced_usd: cost, unpriced_calls: unpriced, unreadable_applications: unread },
    filter: cls || null,
  });

  const toggleBlock = async (a: Application) => {
    setBusy(a.id);
    try {
      await patchApplication(a.id, { blocked: !a.blocked });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const tiles: { id: ApplicationClass | "blocked" | "fired" | "cost"; label: string; value: string; sub: string; tone?: "warn" | "err" }[] = [
    { id: "chatbot", label: "Chatbots", value: apps ? String(count("chatbot")) : "…", sub: "registered, through the gateway" },
    { id: "rag", label: "RAG apps", value: apps ? String(count("rag")) : "…", sub: "registered, through the gateway" },
    { id: "agent", label: "Agents", value: apps ? String(count("agent")) : "…", sub: "deployed on the Agents page" },
    { id: "multi_agent", label: "Multi-agent systems", value: apps ? String(count("multi_agent")) : "…", sub: "deployed agents that start sub-runs" },
    { id: "blocked", label: "Blocked", value: apps ? String(blocked) : "…", sub: "the gateway refuses every call", tone: blocked ? "err" : undefined },
    { id: "fired", label: "Controls fired", value: apps && !pending ? fired.toLocaleString("en-GB") : "…", sub: unread ? `last 30 days · ${unread} not read` : "last 30 days, refusals and screening hits", tone: fired ? "warn" : undefined },
    {
      id: "cost",
      label: "Spend",
      value: apps && !pending ? (priced.length || !unpriced ? money(cost) : "no price set") : "…",
      sub: unpriced ? `last 30 days · ${unpriced} call${unpriced === 1 ? "" : "s"} with no price set, not in it` : "last 30 days, registered applications",
    },
  ];

  return (
    <div className="min-h-full" data-hue="blue">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7">
        <GroupHeader group="agents" tab="applications" actions={<Button size="sm" variant="solid" tone="ink" permission="configure" disabled={connectDoor.off} title={connectDoor.why} onClick={() => setConnecting(true)}>Register an application</Button>}>
          The chatbots and RAG apps registered on this deployment, and the agents deployed on it. A registered application calls models through the gateway with the key minted here; the gateway holds every call to the application&rsquo;s policy (its models, data class, rate and budget), screens the prompt and the reply, and journals the call. Agents are listed here and governed on the Agents page.
        </GroupHeader>

        {error && <Failure what="The applications register could not be read" message={error} />}

        {/* ── the band ── */}
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-line bg-surface sm:grid-cols-4 xl:grid-cols-7">
          {tiles.map((t) => {
            const isClass = t.id === "chatbot" || t.id === "rag" || t.id === "agent" || t.id === "multi_agent";
            const active = isClass && cls === t.id;
            return (
              <div
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (t.id === "chatbot" || t.id === "rag" || t.id === "agent" || t.id === "multi_agent") setCls(cls === t.id ? "" : t.id);
                  else setCls("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).click();
                  }
                }}
                aria-pressed={active}
                className={`focusable -mr-px -mb-px flex cursor-pointer flex-col gap-1 border-r border-b border-line px-3 py-2.5 text-left transition-colors ${active ? "bg-raise/80" : "hover:bg-raise/50"}`}
              >
                <span className="truncate text-[10.5px] text-faint">{t.label}</span>
                {off ? (
                  <span className="flex h-[22px] items-center text-[12px] text-faint">Not read</span>
                ) : (
                  <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]" style={t.tone ? { color: `var(--color-${t.tone})` } : undefined}>{t.value}</span>
                )}
                <span className="truncate text-[10px] text-ghost">{t.sub}</span>
              </div>
            );
          })}
        </div>

        {/* ── the register ── */}
        <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
          <div className="flex w-full flex-wrap items-center gap-3 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Register</span>
            <span className="max-w-[110ch] text-[11px] leading-[1.55] text-faint">
              {off ? "" : apps ? `${shown.length} of ${apps.length} · ` : "reading the register… · "}last seen, cost and controls fired are read from each registered application&rsquo;s journalled calls over the last 30 days
            </span>
            <span className="grow" />
            <SearchBox value={q} onChange={setQ} placeholder="Name, id or owner" width="w-[220px]" />
            {cls && <Button size="sm" variant="quiet" onClick={() => setCls("")}>Every class</Button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-[11.5px]">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line text-left text-[10.5px] text-faint">
                  <th className="px-4 py-2 font-medium">Application</th>
                  <th className="px-3 py-2 font-medium">Class</th>
                  <th className="px-3 py-2 font-medium">Autonomy</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Identity</th>
                  <th className="px-3 py-2 font-medium">Policy</th>
                  <th className="px-3 py-2 font-medium">Last seen</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Controls fired</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => {
                  const own = a.source === "application";
                  const act = activity[a.id];
                  return (
                    <tr key={a.id} className="border-b border-line last:border-0 hover:bg-raise/50">
                      <td className="px-4 py-2 align-top">
                        <Link href={own ? `/applications/${encodeURIComponent(a.id)}` : agentHref(a.id)} className="focusable flex flex-col">
                          <span className="text-[12px] font-medium text-fg">{a.name}</span>
                          <span className="font-mono text-[10.5px] text-faint">{a.id}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2 align-top"><Tag tone={CLASS_TONE[a.class]}>{CLASS_LABEL[a.class]}</Tag></td>
                      <td className="px-3 py-2 align-top text-dim">{autonomyLabel(a.autonomy)}</td>
                      <td className="px-3 py-2 align-top text-dim">{a.owner || <span className="text-ghost">not recorded</span>}</td>
                      <td className="px-3 py-2 align-top">
                        <span className="flex flex-col">
                          <Mono className="text-[10.5px]">{a.key_prefix ? `${a.key_prefix}…` : "—"}</Mono>
                          <span className="text-[10px] text-ghost">{own ? "application key" : "deployed agent"}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {own ? (
                          <span className="flex flex-col">
                            <span className="text-dim">{policyLine(a.policy)}</span>
                            <span className="text-[10px] text-ghost">
                              {a.policy.models.join(", ")}
                              {a.policy.knowledge_stores.length ? ` · stores ${a.policy.knowledge_stores.join(", ")}` : ""}
                              {a.class === "chatbot" ? (a.policy.system_prompt ? " · registered prompt" : " · no registered prompt") : ""}
                              {a.class === "chatbot" && a.policy.answers === "blocks" ? " · answers in blocks" : ""}
                            </span>
                          </span>
                        ) : (
                          <span className="text-ghost">its definition&rsquo;s policy</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap text-dim">{!own ? <span className="text-ghost">runs</span> : act ? (act.unknown ? "not read" : ago(act.last_seen, now)) : "…"}</td>
                      <td className="tnum px-3 py-2 text-right align-top">{!own ? <span className="text-ghost">on Costs</span> : act ? (act.unknown ? "not read" : costLine(act.cost, act.unpriced)) : "…"}</td>
                      <td className="tnum px-3 py-2 text-right align-top">
                        {!own ? <span className="text-ghost">—</span> : act ? act.unknown ? <span className="text-ghost">not read</span> : <span className={act.controls_fired ? "text-warn" : "text-ghost"}>{act.controls_fired.toLocaleString("en-GB")}</span> : "…"}
                      </td>
                      <td className="px-3 py-2 align-top">{!own ? <Status tone="ok">deployed</Status> : a.blocked ? <Status tone="err">blocked</Status> : <Status tone="ok">admitted</Status>}</td>
                      <td className="px-3 py-2 align-top">
                        <span className="flex items-center justify-end gap-1.5">
                          {own ? (
                            <>
                              <Button size="sm" variant="quiet" href={`/applications/${encodeURIComponent(a.id)}`}>Open</Button>
                              <Button size="sm" variant="solid" tone={a.blocked ? "ok" : "err"} permission="configure" loading={busy === a.id} onClick={() => toggleBlock(a)}>
                                {a.blocked ? "Unblock" : "Block"}
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" variant="quiet" href={agentHref(a.id)}>Agent</Button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {apps && shown.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-[11.5px] text-faint">
                      {off ? "The register was not read, so nothing is listed." : apps.length ? "Nothing matches." : "Nothing is registered and no agent is deployed. Register a chatbot or RAG app above; an agent joins the register when it is deployed on the Agents page."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {Object.keys(notBuilt).length > 0 && (
          <section className="flex flex-col gap-1 rounded-md border border-line bg-surface px-4 py-3 text-[11.5px] leading-[1.55] text-faint">
            <span className="font-medium text-dim">Recorded, and not carried out by this deployment</span>
            {Object.entries(notBuilt).map(([k, v]) => (
              <span key={k}>
                <Mono className="text-[10.5px]">{k}</Mono>: {v}.
              </span>
            ))}
          </section>
        )}

        <p className="pb-2 text-[10.5px] text-ghost">
          {gateway ? `Applications call the gateway at ${gateway}, outside the console’s sign-in.` : machineLine(machine, GATEWAY_PATH, "applications cannot reach the gateway")} An application&rsquo;s key is
          shown once, when it is registered.
        </p>
      </div>

      {connecting && (
        <ConnectDialog
          notBuilt={notBuilt}
          onClose={() => setConnecting(false)}
          onMinted={(m) => {
            setMinted(m);
            setConnecting(false);
            load();
          }}
        />
      )}
      {minted && <MintedDialog minted={minted} onClose={() => setMinted(null)} />}
    </div>
  );
}

/* ═══════════════════ register ═══════════════════ */

interface ConfigModel {
  id: string;
  label: string;
  cleared_for: DataClass[];
  price_in: number | null;
  price_out: number | null;
}

/** The offered models with their clearance and prices (`GET /api/config`), and the knowledge stores (`GET /api/retrieval/access`). */
function useChoices(): { models: ConfigModel[] | null; stores: string[] | null; error: string } {
  const [models, setModels] = useState<ConfigModel[] | null>(null);
  const [stores, setStores] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const read = async (path: string) => {
      const r = await fetch(path);
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || d.error) throw new Error(errorText(d, r, "GET", path));
      return d as Record<string, unknown>;
    };
    read("/api/config")
      .then((d) => {
        if (!live) return;
        const list = Array.isArray(d.models) ? (d.models as Record<string, unknown>[]) : [];
        setModels(
          list.map((m) => ({
            id: String(m.id),
            label: String(m.label || m.id),
            cleared_for: Array.isArray(m.cleared_for) ? (m.cleared_for as DataClass[]) : [],
            price_in: typeof m.price_in === "number" ? m.price_in : null,
            price_out: typeof m.price_out === "number" ? m.price_out : null,
          })),
        );
      })
      .catch((e: Error) => live && (setModels([]), setError(e.message)));
    read("/api/retrieval/access")
      .then((d) => live && setStores((Array.isArray(d.stores) ? (d.stores as Record<string, unknown>[]) : []).map((s) => String(s.id))))
      .catch((e: Error) => live && (setStores([]), setError((x) => x || e.message)));
    return () => {
      live = false;
    };
  }, []);
  return { models, stores, error };
}

/** A number typed in a field: the number when it is one, else the text as typed, so the service refuses it in its own words. Empty is null. */
const typed = (s: string): number | string | null => (s.trim() === "" ? null : Number.isFinite(Number(s.trim())) ? Number(s.trim()) : s.trim());

function ConnectDialog({ notBuilt, onClose, onMinted }: { notBuilt: Record<string, string>; onClose: () => void; onMinted: (m: Minted) => void }) {
  const { session } = useSession();
  const { models: offered, stores, error: choicesError } = useChoices();
  const [cls, setCls] = useState<"chatbot" | "rag">("chatbot");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState<string | null>(null);
  const [autonomy, setAutonomy] = useState<Autonomy | "">("");
  const [dataClass, setDataClass] = useState<DataClass>("internal");
  const [models, setModels] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [rate, setRate] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<BudgetPeriod>("month");
  const [prompt, setPrompt] = useState("");
  const [answers, setAnswers] = useState<AnswerMode>("text");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The accountable person starts as whoever registers it; they may name a team or someone else.
  const ownerValue = owner ?? session?.email ?? "";
  const toggleModel = (id: string) => setModels((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const first = (id: string) => setModels((m) => [id, ...m.filter((x) => x !== id)]);
  const toggleStore = (id: string) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async () => {
    setBusy(true);
    setError("");
    const policy: Record<string, unknown> = {
      models,
      data_class: dataClass,
      rate_per_minute: typed(rate),
      budget: amount.trim() === "" ? null : { amount_usd: typed(amount), period },
    };
    if (cls === "chatbot") {
      policy.system_prompt = prompt.trim();
      policy.answers = answers;
    } else policy.knowledge_stores = picked;
    try {
      onMinted(await createApplication({ name: name.trim(), class: cls, owner: ownerValue.trim(), autonomy: autonomy || null, policy: policy as PolicyWire }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unpricedPicked = models.filter((id) => {
    const m = offered?.find((x) => x.id === id);
    return m && (m.price_in === null || m.price_out === null);
  });

  return (
    <DrillModal
      title="Register an application"
      subtitle="A chatbot or a RAG app, with the policy the gateway holds each of its calls to. Its key is minted once and shown with the code to paste."
      onClose={onClose}
      actions={
        <Button variant="solid" tone="ink" size="sm" permission="configure" loading={busy} disabled={!name.trim()} onClick={submit}>Register and mint the key</Button>
      }
    >
      <form
        className="grid gap-4 p-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !busy) submit();
        }}
      >
        <Field label="Class" hint="A chatbot has a registered system prompt; a RAG app names its knowledge stores and sends its own instructions.">
          <Pick value={cls} onChange={setCls} options={[{ value: "chatbot", label: "Chatbot" }, { value: "rag", label: "RAG app" }]} size="md" aria-label="Class" />
        </Field>
        <Field label="Name" htmlFor="app-name">
          <Input id="app-name" value={name} onChange={setName} />
        </Field>
        <Field label="Owner" htmlFor="app-owner" hint="The person or team accountable for what it answers.">
          <Input id="app-owner" value={ownerValue} onChange={setOwner} />
        </Field>
        <Field label="Autonomy" hint={notBuilt.autonomy ? `Declared, and ${notBuilt.autonomy.replace(/^an application's autonomy tier is recorded as declared; /, "")}.` : "The tier declared for it."}>
          <Pick value={autonomy} onChange={setAutonomy} options={[{ value: "" as Autonomy | "", label: "not declared" }, ...AUTONOMIES.map((a) => ({ value: a as Autonomy | "", label: AUTONOMY_LABEL[a] }))]} size="md" aria-label="Autonomy" />
        </Field>
        <Field label="Data class" hint="The most sensitive class of data it handles. Every call is sent only to a model cleared for it (Configuration, Models).">
          <Pick value={dataClass} onChange={setDataClass} options={DATA_CLASSES.map((c) => ({ value: c, label: c }))} size="md" aria-label="Data class" />
        </Field>
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Field label="Rate per minute" htmlFor="app-rate">
            <Input id="app-rate" value={rate} onChange={setRate} placeholder="no limit" mono />
          </Field>
          <Field label="Budget (USD)" htmlFor="app-budget">
            <Input id="app-budget" value={amount} onChange={setAmount} placeholder="none" mono />
          </Field>
          <div className="w-24 pb-px">
            <Pick value={period} onChange={setPeriod} options={[{ value: "day", label: "a day" }, { value: "week", label: "a week" }, { value: "month", label: "a month" }]} size="md" aria-label="Budget period" />
          </div>
        </div>
        <div className="flex flex-col gap-2 md:col-span-2">
          <span className="text-[12.5px] font-medium text-mist">Models it may call</span>
          <span className="text-[11.5px] leading-[1.5] text-faint">
            In order; chat uses the first. Only models this deployment offers can be listed. A model not cleared for {dataClass} data is refused unless its first cleared fallback is listed too.
          </span>
          {offered === null && <span className="text-[11.5px] text-faint">Reading the offered models…</span>}
          {offered?.length === 0 && !choicesError && <span className="text-[11.5px] text-warn">This deployment offers no model yet: offer one under Configuration, Models.</span>}
          <div className="flex flex-col divide-y divide-line rounded-md border border-line">
            {(offered ?? []).map((m) => {
              const at = models.indexOf(m.id);
              const cleared = m.cleared_for.includes(dataClass);
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-1.5">
                  <Checkbox checked={at >= 0} onChange={() => toggleModel(m.id)} aria-label={`Allow ${m.label}`} />
                  <span className="flex min-w-0 grow flex-col">
                    <span className="text-[12px] text-fg">
                      {m.label}
                      {at === 0 && <span className="ml-2 text-[10.5px] text-ok">chat uses this one</span>}
                      {at > 0 && <span className="ml-2 text-[10.5px] text-faint">{at + 1}</span>}
                    </span>
                    <span className="text-[10.5px] text-faint">
                      cleared for {m.cleared_for.join(", ")}
                      {!cleared && <span className="text-warn"> · not cleared for {dataClass}</span>}
                      {m.price_in === null || m.price_out === null ? <span className="text-warn"> · no price set</span> : ` · $${m.price_in} in · $${m.price_out} out per million tokens`}
                    </span>
                  </span>
                  {at > 0 && (
                    <Button size="sm" variant="quiet" onClick={() => first(m.id)}>
                      Make first
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {amount.trim() !== "" && unpricedPicked.length > 0 && (
            <span className="text-[11.5px] leading-[1.5] text-warn">
              With a budget, a call on a model with no price set is refused, because its spend cannot be counted: {unpricedPicked.join(", ")}.
            </span>
          )}
          <span className="text-[11.5px] leading-[1.5] text-faint">
            A budget is a calendar period in UTC (a week starts on Monday). A rate limit answers 429, a spent budget 402.
          </span>
        </div>
        {cls === "rag" ? (
          <div className="flex flex-col gap-2 md:col-span-2">
            <span className="text-[12.5px] font-medium text-mist">Knowledge stores</span>
            <span className="text-[11.5px] leading-[1.5] text-faint">At least one. {notBuilt.retrieval ? `${notBuilt.retrieval[0].toUpperCase()}${notBuilt.retrieval.slice(1)}.` : ""}</span>
            {stores === null && <span className="text-[11.5px] text-faint">Reading the knowledge stores…</span>}
            {stores?.length === 0 && !choicesError && <span className="text-[11.5px] text-warn">There is no knowledge store on this deployment yet.</span>}
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {(stores ?? []).map((s) => (
                <Checkbox key={s} label={s} checked={picked.includes(s)} onChange={() => toggleStore(s)} />
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="md:col-span-2">
              <Field label="System prompt (optional)" htmlFor="app-prompt" hint="Registered here and put first on every call by the gateway; the chatbot then sends no system message of its own. A reply that repeats it is withheld.">
                <Textarea id="app-prompt" value={prompt} onChange={setPrompt} rows={4} />
              </Field>
            </div>
            <Field label="Answers in the console's chat" hint={ANSWERS_HINT}>
              <Pick value={answers} onChange={setAnswers} options={ANSWER_OPTIONS} size="md" aria-label="Answers in the console's chat" />
            </Field>
          </>
        )}
        {choicesError && <p className="text-[11.5px] text-err md:col-span-2" role="alert">{choicesError}</p>}
        {error && (
          <p className="text-[11.5px] text-err md:col-span-2" role="alert">
            <span className="font-medium">Not registered.</span> {error}
          </p>
        )}
        <div className="flex justify-end gap-2 md:col-span-2">
          <Button variant="solid" tone="err" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="solid" tone="ink" size="sm" type="submit" permission="configure" loading={busy} disabled={!name.trim()}>Register and mint the key</Button>
        </div>
      </form>
    </DrillModal>
  );
}

/* ═══════════════════ the key, once ═══════════════════ */

function MintedDialog({ minted, onClose }: { minted: Minted; onClose: () => void }) {
  const a = minted.application;
  const [lang, setLang] = useState<"python" | "typescript">("python");
  const machine = useMachineOrigin();
  const gateway = machineAddress(machine, GATEWAY_PATH);
  const ctx = { key: minted.key, model: a.policy.models[0] ?? "", base: gateway ?? "" };
  return (
    <DrillModal
      title={`${a.name} registered`}
      subtitle={minted.note || "This is the only time the key is shown."}
      onClose={onClose}
      actions={<Button size="sm" variant="quiet" href={`/applications/${encodeURIComponent(a.id)}`}>Open the dashboard</Button>}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-3 rounded-sm border border-ok-line bg-ok-bg px-3 py-2">
          <Status tone="ok">key minted</Status>
          <Mono className="break-all text-[11px] text-fg">{minted.key}</Mono>
          <CopyButton text={minted.key} />
          <span className="text-[10.5px] text-faint">Scoped to {a.id}. Blocking the application refuses every call; removing it revokes the key.</span>
        </div>
        {minted.system_prompt && (
          <p className="text-[11px] leading-[1.55] text-faint">
            System prompt recorded as version {minted.system_prompt.version}
            {minted.system_prompt.set_by ? `, signed ${minted.system_prompt.set_by}` : ""} ({minted.system_prompt.chars.toLocaleString("en-GB")} characters). Every later change is a new version on the
            application&rsquo;s page.
          </p>
        )}

        <section className="flex flex-col overflow-hidden rounded-md border border-line">
          <div className="flex items-center gap-2 border-b border-line bg-raise/55 px-3 py-2">
            <span className="text-[12px] font-semibold">OpenAI SDK, pointed at the gateway</span>
            {gateway && <Mono className="text-[10.5px] text-faint">{gateway}</Mono>}
            <span className="grow" />
            {gateway && (
              <>
                <span className="flex items-center rounded-md border border-line bg-canvas p-0.5">
                  {(["python", "typescript"] as const).map((l) => (
                    <button key={l} type="button" onClick={() => setLang(l)} className={`focusable rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-colors ${lang === l ? "bg-surface text-fg elev-1" : "text-faint hover:text-fg"}`}>
                      {l === "python" ? "Python" : "TypeScript"}
                    </button>
                  ))}
                </span>
                <CopyButton text={SNIPPETS[lang](ctx)} />
              </>
            )}
          </div>
          {gateway ? (
            <Code text={SNIPPETS[lang](ctx)} lang={lang} className="bg-raise/40" />
          ) : (
            <p className={`px-3 py-3 text-[11.5px] leading-[1.55] ${machine === undefined ? "text-faint" : "text-warn"}`}>
              {machineLine(machine, GATEWAY_PATH, "applications cannot reach the gateway")}
              {machine === null && " The code to paste is shown once the deployment names that address."}
            </p>
          )}
        </section>

        {gateway && (
          <p className="text-[11px] leading-[1.55] text-faint">
            Applications call the gateway at {gateway}, the service&rsquo;s own address, outside the console&rsquo;s sign-in: the gateway refuses a call that carries a console sign-in.
          </p>
        )}
        <p className="text-[11px] leading-[1.55] text-faint">
          The gateway takes this key and nothing else. It holds every call to the policy ({policyLine(a.policy)}; models {a.policy.models.join(", ")}), screens the prompt and the reply (a block is
          refused naming the control, a flag is recorded and let through), and journals the call with its tokens, its cost (none when its model has no price set), its latency and its model.
        </p>
      </div>
    </DrillModal>
  );
}
