"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AUTONOMY_LABEL,
  CLASS_LABEL,
  GATEWAY_URL,
  RETRIEVAL_URL,
  SNIPPETS,
  activityOf,
  applicationOf,
  listApplications,
  patchApplication,
  policyToWire,
  promptVersionOf,
  type Activity,
  type Application,
  type ApplicationClass,
  type Minted,
  type NewApplication,
  type Policy,
} from "@/lib/api/l4";
import { api, errorText } from "@/lib/api/client";
import { QUIET } from "@/lib/quiet";
import { QuietNote } from "./overlays";
import { Button, Mono, Status, Tag } from "./ui";
import { Pick } from "./select";
import { Code, CopyButton } from "./code";
import { DrillModal } from "./drill";
import { Checkbox, Field, Input, Textarea } from "./forms";
import { SearchBox } from "./filters";
import { usePageFacts } from "./assistant";
import { useModels } from "@/lib/use-models";

/**
 * The applications register: every chatbot, RAG app, agent and multi-agent
 * system this control plane governs, in one list, with the class, autonomy,
 * owner, identity, activity, cost and the controls that fired on each.
 *
 * Chatbots and RAG apps connect here: a row is created, a scoped key is
 * minted once, and the snippet on screen is the one to paste, pointing an
 * OpenAI SDK at the gateway. Agents and multi-agent systems arrive from
 * the Workflows register and the attached-agents panel on Configuration;
 * this page lists them and sends a reader there to change them. The
 * activity beside a row (last seen, cost, controls fired over 30 days) is
 * read from the row's own metrics and conversations doors.
 */

const CLASS_TONE: Record<ApplicationClass, "queue" | "ok" | "run" | "warn"> = { chatbot: "queue", rag: "ok", agent: "run", multi_agent: "warn" };
const SOURCE_LABEL: Record<Application["source"], string> = { application: "application key", attached: "attached-agent key", workflow: "workflow" };

function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const money = (c: number | null) => (c === null ? "unknown" : c === 0 ? "$0.00" : c < 0.005 ? "<$0.01" : c < 100 ? `$${c.toFixed(2)}` : `$${Math.round(c).toLocaleString("en-GB")}`);

/** Read every row's activity, a few doors at a time, so a long register does not open fifty connections at once. */
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
  const [activity, setActivity] = useState<Record<string, Activity>>({});
  const [error, setError] = useState("");
  const [cls, setCls] = useState<ApplicationClass | "">("");
  const [q, setQ] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    listApplications()
      .then((rows) => {
        setApps(rows);
        setError("");
        void activities(
          rows.map((r) => r.id),
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

  const count = (c: ApplicationClass) => (apps ?? []).filter((a) => a.class === c).length;
  const blocked = (apps ?? []).filter((a) => a.blocked).length;
  const known = Object.values(activity).filter((a) => !a.unknown);
  const fired = known.reduce((s, a) => s + a.controls_fired, 0);
  const priced = known.filter((a) => a.cost !== null);
  const cost = priced.length ? priced.reduce((s, a) => s + (a.cost ?? 0), 0) : null;
  const pending = apps ? apps.filter((a) => !activity[a.id]).length : 0;
  // A quiet console (lib/quiet.ts): the register could not be read, so the page says it is not connected and counts nothing.
  const unread = QUIET && Boolean(error) && (apps?.length ?? 0) === 0;

  usePageFacts({
    applications: unread ? "not connected" : apps ? apps.length : "loading",
    byClass: apps ? Object.fromEntries((["chatbot", "rag", "agent", "multi_agent"] as ApplicationClass[]).map((c) => [c, count(c)])) : null,
    blocked,
    controlsFired30d: fired,
    spend30d: cost,
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
    { id: "chatbot", label: "Chatbots", value: apps ? String(count("chatbot")) : "…", sub: "through the gateway" },
    { id: "rag", label: "RAG apps", value: apps ? String(count("rag")) : "…", sub: "gateway and retrieval door" },
    { id: "agent", label: "Agents", value: apps ? String(count("agent")) : "…", sub: "workflows and attached agents" },
    { id: "multi_agent", label: "Multi-agent systems", value: apps ? String(count("multi_agent")) : "…", sub: "workflows with sub-runs or peers" },
    { id: "blocked", label: "Blocked", value: apps ? String(blocked) : "…", sub: "every door refuses", tone: blocked ? "err" : undefined },
    { id: "fired", label: "Controls fired", value: apps && !pending ? fired.toLocaleString("en-GB") : "…", sub: "last 30 days, from the journals", tone: fired ? "warn" : undefined },
    { id: "cost", label: "Spend", value: apps && !pending ? money(cost) : "…", sub: known.length - priced.length > 0 ? `${known.length - priced.length} unpriced` : "last 30 days" },
  ];

  return (
    <div className="min-h-full" data-hue="blue">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7">
        <header className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">Applications</h1>
            <p className="max-w-[72ch] text-[12.5px] leading-[1.55] text-dim">
              Every AI application this control plane governs, across the four classes. A chatbot or RAG app connects by pointing its OpenAI SDK at the
              gateway with the key minted here; the gateway screens every prompt and response, journals every completion and enforces the policy on the row.
              Agents and multi-agent systems are listed from the Workflows register and the attached agents.
            </p>
          </div>
          <span className="grow" />
          <Button variant="solid" tone="ink" permission="configure" onClick={() => setConnecting(true)}>Connect an application</Button>
        </header>

        {error && !QUIET && <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">{error}</p>}
        {error && QUIET && (unread ? <QuietNote /> : <QuietNote inline />)}

        {/* ── the band ── */}
        {!unread && <div className="grid grid-cols-2 overflow-hidden rounded-md border border-line bg-surface sm:grid-cols-4 xl:grid-cols-7">
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
                  if (t.id === "blocked") setQ("");
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
                <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]" style={t.tone ? { color: `var(--color-${t.tone})` } : undefined}>{t.value}</span>
                <span className="truncate text-[10px] text-ghost">{t.sub}</span>
              </div>
            );
          })}
        </div>}

        {/* ── the register ── */}
        {!unread && <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
          <div className="flex w-full flex-wrap items-center gap-3 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Register</span>
            <span className="max-w-[110ch] text-[11px] leading-[1.55] text-faint">
              {apps ? `${shown.length} of ${apps.length}` : "reading the register…"} · last seen, cost and firings are read from each row&rsquo;s journalled completions over the last 30 days
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
                        <Link href={`/applications/${encodeURIComponent(a.id)}`} className="focusable flex flex-col">
                          <span className="text-[12px] font-medium text-fg">{a.name}</span>
                          <span className="font-mono text-[10.5px] text-faint">{a.id}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2 align-top"><Tag tone={CLASS_TONE[a.class]}>{CLASS_LABEL[a.class]}</Tag></td>
                      <td className="px-3 py-2 align-top text-dim">{AUTONOMY_LABEL[a.autonomy]}</td>
                      <td className="px-3 py-2 align-top text-dim">{a.owner || <span className="text-ghost">unassigned</span>}</td>
                      <td className="px-3 py-2 align-top">
                        <span className="flex flex-col">
                          <Mono className="text-[10.5px]">{a.key_prefix ? `${a.key_prefix}…` : "—"}</Mono>
                          <span className="text-[10px] text-ghost">{SOURCE_LABEL[a.source]}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className="flex flex-col">
                          <span className="text-dim">screen: {a.policy.screen}{a.policy.principal_required ? " · principal required" : ""}</span>
                          <span className="text-[10px] text-ghost">
                            {a.policy.namespaces.length ? `${a.policy.namespaces.length} namespace${a.policy.namespaces.length === 1 ? "" : "s"}` : "no retrieval"}
                            {a.policy.models.length ? ` · ${a.policy.models.length} model${a.policy.models.length === 1 ? "" : "s"}` : a.policy.model ? ` · ${a.policy.model}` : " · default model"}
                            {a.policy.system_prompt ? " · registered prompt" : ""}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap text-dim">{act ? (act.unknown ? "unknown" : ago(act.last_seen, now)) : "…"}</td>
                      <td className="tnum px-3 py-2 text-right align-top">{act ? (act.unknown ? "unknown" : money(act.cost)) : "…"}</td>
                      <td className="tnum px-3 py-2 text-right align-top">
                        {act ? act.unknown ? <span className="text-ghost">unknown</span> : <span className={act.controls_fired ? "text-warn" : "text-ghost"}>{act.controls_fired.toLocaleString("en-GB")}</span> : "…"}
                      </td>
                      <td className="px-3 py-2 align-top">{a.blocked ? <Status tone="err">blocked</Status> : <Status tone="ok">admitted</Status>}</td>
                      <td className="px-3 py-2 align-top">
                        <span className="flex items-center justify-end gap-1.5">
                          <Button size="sm" variant="quiet" href={`/applications/${encodeURIComponent(a.id)}`}>Open</Button>
                          {own ? (
                            <Button size="sm" variant="solid" tone={a.blocked ? "ok" : "err"} permission="configure" loading={busy === a.id} onClick={() => toggleBlock(a)}>
                              {a.blocked ? "Unblock" : "Block"}
                            </Button>
                          ) : (
                            <Button size="sm" variant="quiet" href={a.source === "attached" ? "/configuration#agents" : `/workflows?id=${encodeURIComponent(a.id)}`}>
                              {a.source === "attached" ? "Attached agents" : "Workflow"}
                            </Button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {apps && shown.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-[11.5px] text-faint">
                      {apps.length ? "Nothing matches." : "Nothing is registered yet. Connect a chatbot or RAG app above; agents appear from the Workflows register once deployed."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>}

        {/* ── the agent classes come from elsewhere ── */}
        <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
          <div className="flex w-full items-start gap-3 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Agents and multi-agent systems</span>
            <span className="max-w-[110ch] text-[11px] leading-[1.55] text-faint">listed here, governed where they are built</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-[11.5px] leading-[1.55] text-faint">
            <span className="max-w-[80ch]">
              A workflow saved on this deployment is an agent (or a multi-agent system, when it runs sub-runs or peers) the moment it is deployed. A third-party agent is
              attached on the Configuration page, where its grants, gate risk and injection mode are set; the SDK and A2A doors keep serving it.
            </span>
            <span className="grow" />
            <Button size="sm" variant="quiet" href="/workflows">Workflows</Button>
            <Button size="sm" variant="quiet" href="/configuration#agents">Attached agents</Button>
          </div>
        </section>

        <p className="pb-2 text-[10.5px] text-ghost">
          The gateway is {GATEWAY_URL}; the retrieval door is {RETRIEVAL_URL}. A key is shown once, when the application is connected.
        </p>
      </div>

      {connecting && (
        <ConnectDialog
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

/* ═══════════════════ connect ═══════════════════ */

/**
 * `POST /api/applications`, with the policy's fallback models (5.5).
 *
 * The register's policy carries `fallbacks`: a list of model names the
 * gateway tries, in order, when the chosen model's upstream fails
 * (backend/app/applications.py `PolicyView.fallbacks`, gateway.py `_chain`).
 * The console's own policy shape (lib/api/l4.ts `Policy`, `policyToWire`)
 * does not carry the field yet, so the registration is sent from here with
 * it beside the rest; it is sent only when the form names one.
 */
async function registerApplication(body: NewApplication, fallbacks: string[]): Promise<Minted> {
  const { data, error, response } = await api.POST("/api/applications", {
    body: { name: body.name, class: body.class, owner: body.owner, autonomy: body.autonomy ?? null, policy: { ...policyToWire(body.policy), ...(fallbacks.length ? { fallbacks } : {}) } },
  });
  if (!data) throw new Error(errorText(error, response));
  return { application: applicationOf(data.application), key: data.key, note: data.note, system_prompt: data.system_prompt ? promptVersionOf(data.system_prompt) : null };
}

const csv = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number.isFinite(Number(s)) ? Number(s) : null);

function LimitFields({ value, onChange, idPrefix }: { value: { rpm: string; tpd: string; cpd: string }; onChange: (v: { rpm: string; tpd: string; cpd: string }) => void; idPrefix: string }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Field label="Requests / min" htmlFor={`${idPrefix}-rpm`}>
        <Input id={`${idPrefix}-rpm`} value={value.rpm} onChange={(v) => onChange({ ...value, rpm: v })} placeholder="no limit" mono />
      </Field>
      <Field label="Tokens / day" htmlFor={`${idPrefix}-tpd`}>
        <Input id={`${idPrefix}-tpd`} value={value.tpd} onChange={(v) => onChange({ ...value, tpd: v })} placeholder="no limit" mono />
      </Field>
      <Field label="Cost / day (USD)" htmlFor={`${idPrefix}-cpd`}>
        <Input id={`${idPrefix}-cpd`} value={value.cpd} onChange={(v) => onChange({ ...value, cpd: v })} placeholder="no limit" mono />
      </Field>
    </div>
  );
}

function ConnectDialog({ onClose, onMinted }: { onClose: () => void; onMinted: (m: Minted) => void }) {
  const { models, defaultModel } = useModels();
  const [cls, setCls] = useState<"chatbot" | "rag">("chatbot");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [screen, setScreen] = useState<"block" | "flag">("block");
  const [header, setHeader] = useState("x-principal");
  const [requirePrincipal, setRequirePrincipal] = useState(true);
  const [limits, setLimits] = useState({ rpm: "", tpd: "", cpd: "" });
  const [perPrincipal, setPerPrincipal] = useState({ rpm: "", tpd: "", cpd: "" });
  const [namespaces, setNamespaces] = useState("default");
  const [allowed, setAllowed] = useState<string>("");
  const [fallbacks, setFallbacks] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const allowedModels = csv(allowed);
  const policy: Partial<Policy> = {
    screen,
    principal_header: header.trim() || "x-principal",
    principal_required: requirePrincipal,
    limits: { requests_per_minute: numOrNull(limits.rpm), tokens_per_day: numOrNull(limits.tpd), cost_per_day_usd: numOrNull(limits.cpd) },
    principal_limits: { requests_per_minute: numOrNull(perPrincipal.rpm), tokens_per_day: numOrNull(perPrincipal.tpd), cost_per_day_usd: numOrNull(perPrincipal.cpd) },
    namespaces: cls === "rag" ? csv(namespaces) : [],
    model: allowedModels[0] ?? "",
    models: allowedModels,
    system_prompt: prompt.trim(),
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const m = await registerApplication({ name: name.trim(), class: cls, owner: owner.trim(), autonomy: cls === "rag" ? "L1" : "L0", policy }, csv(fallbacks));
      onMinted(m);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const modelOptions = useMemo(() => (models ?? []).map((m) => m.id), [models]);

  return (
    <DrillModal
      title="Connect an application"
      subtitle="A chatbot or a RAG app. The row carries its policy; the key is minted once and shown with the snippet to paste."
      onClose={onClose}
      actions={
        <Button variant="solid" tone="ink" size="sm" permission="configure" loading={busy} disabled={!name.trim()} onClick={submit}>Connect and mint the key</Button>
      }
    >
      <form
        className="grid gap-4 p-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !busy) submit();
        }}
      >
        <Field label="Class" hint="A RAG app may also call the retrieval door; a chatbot only the gateway.">
          <Pick value={cls} onChange={setCls} options={[{ value: "chatbot", label: "Chatbot" }, { value: "rag", label: "RAG app" }]} size="md" aria-label="Class" />
        </Field>
        <Field label="Name" htmlFor="app-name">
          <Input id="app-name" value={name} onChange={setName} />
        </Field>
        <Field label="Owner" htmlFor="app-owner" hint="The team accountable for what it answers.">
          <Input id="app-owner" value={owner} onChange={setOwner} />
        </Field>
        <Field label="Screening" hint="Block refuses a screened prompt or response with HTTP 400 naming the control; flag journals it and lets it through.">
          <Pick value={screen} onChange={setScreen} options={[{ value: "block", label: "Block" }, { value: "flag", label: "Flag" }]} size="md" aria-label="Screening" />
        </Field>
        <Field label="Principal header" htmlFor="app-header" hint="The header the end user's identity arrives in; limits and entitlements are per principal.">
          <Input id="app-header" value={header} onChange={setHeader} placeholder="x-principal" mono />
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox label="Refuse a request that carries no principal" checked={requirePrincipal} onChange={setRequirePrincipal} />
        </div>
        <div className="flex flex-col gap-2 md:col-span-2">
          <span className="text-[12.5px] font-medium text-mist">Limits, per application</span>
          <LimitFields value={limits} onChange={setLimits} idPrefix="app-lim" />
          <span className="text-[12.5px] font-medium text-mist">Limits, per principal</span>
          <LimitFields value={perPrincipal} onChange={setPerPrincipal} idPrefix="app-plim" />
          <span className="text-[11.5px] text-faint">Empty means no limit. A rate limit answers 429; a spent budget 402.</span>
        </div>
        {cls === "rag" && (
          <Field label="Allowed namespaces" htmlFor="app-ns" hint="Knowledge namespaces this app may retrieve from, comma separated. A principal may be entitled to fewer on the row later.">
            <Input id="app-ns" value={namespaces} onChange={setNamespaces} placeholder="default" mono />
          </Field>
        )}
        <Field
          label="Allowed models"
          htmlFor="app-models"
          hint={`Comma separated; the first is the model a caller that names none gets. Empty means the deployment default${defaultModel ? ` (${defaultModel})` : ""}.${modelOptions.length ? ` Configured: ${modelOptions.slice(0, 6).join(", ")}${modelOptions.length > 6 ? ", …" : ""}.` : ""}`}
        >
          <Input id="app-models" value={allowed} onChange={setAllowed} placeholder={modelOptions[0] ?? ""} mono />
        </Field>
        <Field
          label="Fallback models"
          htmlFor="app-fallbacks"
          hint="Model ids or tiers, comma separated, tried in order when the chosen model's upstream fails. Empty means no fallback: the failure goes back to the caller."
        >
          <Input id="app-fallbacks" value={fallbacks} onChange={setFallbacks} placeholder={modelOptions[1] ?? ""} mono />
        </Field>
        <Field label="System prompt (optional)" htmlFor="app-prompt" hint="Registered here and injected by the gateway; the app sends none. A response that echoes it is a screened hit.">
          <Textarea id="app-prompt" value={prompt} onChange={setPrompt} rows={4} />
        </Field>
        {error && (QUIET ? <p className="md:col-span-2" role="status"><QuietNote inline /></p> : <p className="text-[11.5px] text-err md:col-span-2" role="alert">{error}</p>)}
        <div className="flex justify-end gap-2 md:col-span-2">
          <Button variant="solid" tone="err" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="solid" tone="ink" size="sm" type="submit" permission="configure" loading={busy} disabled={!name.trim()}>Connect and mint the key</Button>
        </div>
      </form>
    </DrillModal>
  );
}

/* ═══════════════════ the key, once ═══════════════════ */

function MintedDialog({ minted, onClose }: { minted: Minted; onClose: () => void }) {
  const a = minted.application;
  const [lang, setLang] = useState<"python" | "typescript">("python");
  const ctx = { key: minted.key, principalHeader: a.policy.principal_header, model: a.policy.models[0] ?? a.policy.model, namespace: a.policy.namespaces[0] ?? "default" };
  return (
    <DrillModal
      title={`${a.name} connected`}
      subtitle={minted.note || "This is the only time the key is shown. The snippets below already carry it; copy one into the application and the key never needs to be seen again."}
      onClose={onClose}
      actions={<Button size="sm" variant="quiet" href={`/applications/${encodeURIComponent(a.id)}`}>Open the dashboard</Button>}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-3 rounded-sm border border-ok-line bg-ok-bg px-3 py-2">
          <Status tone="ok">key minted</Status>
          <Mono className="break-all text-[11px] text-fg">{minted.key}</Mono>
          <CopyButton text={minted.key} />
          <span className="text-[10.5px] text-faint">Scoped to {a.id}. Block the application to close every door; remove it to revoke the key.</span>
        </div>
        {minted.system_prompt && (
          <p className="text-[11px] leading-[1.55] text-faint">
            System prompt recorded as version {minted.system_prompt.version}
            {minted.system_prompt.set_by ? `, signed ${minted.system_prompt.set_by}` : ""} ({minted.system_prompt.chars.toLocaleString("en-GB")} characters). Every later change is a new version on the
            application&rsquo;s page, and a response that echoes this one is caught for as long as the leak check keeps it.
          </p>
        )}

        <section className="flex flex-col overflow-hidden rounded-md border border-line">
          <div className="flex items-center gap-2 border-b border-line bg-raise/55 px-3 py-2">
            <span className="text-[12px] font-semibold">OpenAI SDK, pointed at the gateway</span>
            <Mono className="text-[10.5px] text-faint">{GATEWAY_URL}</Mono>
            <span className="grow" />
            <span className="flex items-center rounded-md border border-line bg-canvas p-0.5">
              {(["python", "typescript"] as const).map((l) => (
                <button key={l} type="button" onClick={() => setLang(l)} className={`focusable rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-colors ${lang === l ? "bg-surface text-fg elev-1" : "text-faint hover:text-fg"}`}>
                  {l === "python" ? "Python" : "TypeScript"}
                </button>
              ))}
            </span>
            <CopyButton text={SNIPPETS[lang](ctx)} />
          </div>
          <Code text={SNIPPETS[lang](ctx)} lang={lang} className="bg-raise/40" />
        </section>

        {a.class === "rag" && (
          <section className="flex flex-col overflow-hidden rounded-md border border-line">
            <div className="flex items-center gap-2 border-b border-line bg-raise/55 px-3 py-2">
              <span className="text-[12px] font-semibold">Retrieval door</span>
              <Mono className="text-[10.5px] text-faint">POST {RETRIEVAL_URL}/search</Mono>
              <span className="grow" />
              <CopyButton text={lang === "python" ? SNIPPETS.retrievalPython(ctx) : SNIPPETS.retrieval(ctx)} />
            </div>
            <Code text={lang === "python" ? SNIPPETS.retrievalPython(ctx) : SNIPPETS.retrieval(ctx)} lang={lang === "python" ? "python" : "bash"} className="bg-raise/40" />
          </section>
        )}

        <p className="text-[11px] leading-[1.55] text-faint">
          The gateway screens every user and tool turn and the full response ({a.policy.screen === "block" ? "a hit is refused with the control named" : "a hit is journalled and let through"}),
          enforces the limits on the row, and records every completion with its tokens, cost, latency, model and principal. Set the principal header on every request; without it
          {a.policy.principal_required ? " the request is refused." : " the request is accepted and recorded without one."}
        </p>
      </div>
    </DrillModal>
  );
}
