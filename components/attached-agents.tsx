"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Mono, Status, Tag } from "./ui";
import { Pick } from "./select";
import { Code, CopyButton } from "./code";
import { OpenChanges, ProposalNote } from "./policy";
import {
  A2A_STEPS,
  ENDPOINTS,
  FRAMEWORKS,
  FRAMEWORK_BY_ID,
  LANGUAGES,
  MODE_META,
  RECORDED,
  SHOWN_ON,
  SNIPPETS,
  slugOf,
  type AgentLimits,
  type AttachMode,
  type AttachedAgent,
  type Language,
} from "@/lib/attached";
import { attachAgent, attachableTools, detachAgent, listAttached, setAttachedPolicy, type AttachedList, type PolicyPatch } from "@/lib/api/l2";
import { proposePolicyChange, type PolicyChange } from "@/lib/api/l9";
import { attachedSplit, effectiveAt, effectiveProblem, proposedLine } from "@/lib/policy";

/**
 * Third-party agents: how one attaches, and which ones have.
 *
 * The top half is the manual — the SDK in the five languages teams write
 * agents in, or the A2A route for an agent whose code cannot change — and
 * it renders with the id and key of whatever was just attached, so the
 * snippet on screen is the one to paste. The bottom half is the registry:
 * every attached agent with its activity beside the factory's own.
 */

const MODES: AttachMode[] = ["sdk", "a2a"];

interface PolicyDraft {
  grants: string[];
  gate_at: AttachedAgent["gate_at"];
  injection: AttachedAgent["injection"];
  secret_name: string;
  model: string;
  models: string[];
  fallbacks: string[];
  limits: AgentLimits;
}

const names = (text: string) => text.split(",").map((n) => n.trim()).filter(Boolean);

/** The agent asks for `auto` or a tier and the factory picks: here is who decides what that means for this agent. */
function ModelRouting({ draft, onChange, catalogue, control }: {
  draft: PolicyDraft;
  onChange: (update: (d: PolicyDraft) => PolicyDraft) => void;
  catalogue: { models: string[]; tiers: Record<string, string> };
  control: string;
}) {
  const tiers = Object.entries(catalogue.tiers).filter(([, model]) => model);
  const options = [
    { value: "", label: "the deployment's default" },
    ...tiers.map(([tier, model]) => ({ value: tier, label: `${tier} tier (${model})` })),
    ...catalogue.models.map((m) => ({ value: m, label: m })),
  ];
  if (draft.model && !options.some((o) => o.value === draft.model)) options.push({ value: draft.model, label: draft.model });
  const limit = (name: keyof AgentLimits, label: string, placeholder: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] text-ghost">{label}</span>
      <input
        inputMode="decimal"
        value={draft.limits[name] ?? ""}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange((d) => ({ ...d, limits: { ...d.limits, [name]: e.target.value.trim() && Number.isFinite(n) && n > 0 ? n : undefined } }));
        }}
        className={`${control} w-[110px] font-mono text-[11px]`}
      />
    </label>
  );
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <span className="text-[12px] font-semibold text-fg">Model routing</span>
      <span className="text-[10.5px] leading-[1.5] text-faint">
        The agent asks for <Mono className="text-[10px]">auto</Mono> or a tier, and the factory picks the model. Point its base URL at the gateway and it needs no model names or provider keys of its own.
      </span>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] text-ghost">Default model</span>
          <span className="block w-[260px]">
            <Pick value={draft.model} onChange={(v) => onChange((d) => ({ ...d, model: v }))} options={options} aria-label="Default model" />
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] text-ghost">Allowed models (empty: any offered)</span>
          <input
            defaultValue={draft.models.join(", ")}
            onBlur={(e) => { const v = names(e.target.value); onChange((d) => ({ ...d, models: v })); }}
            placeholder="small, medium"
            spellCheck={false}
            aria-label="Allowed models, separated by commas"
            className={`${control} w-[210px] font-mono text-[11px]`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] text-ghost">If a model fails, try</span>
          <input
            defaultValue={draft.fallbacks.join(", ")}
            onBlur={(e) => { const v = names(e.target.value); onChange((d) => ({ ...d, fallbacks: v })); }}
            placeholder="large"
            spellCheck={false}
            aria-label="Fallback models, separated by commas"
            className={`${control} w-[170px] font-mono text-[11px]`}
          />
        </label>
        {limit("requests_per_minute", "Requests a minute", "none")}
        {limit("tokens_per_day", "Tokens a day", "none")}
        {limit("cost_per_day_usd", "Dollars a day", "none")}
      </div>
    </div>
  );
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function money(n: number | null, runs: number): string {
  if (n === null) return "unpriced";
  if (!runs) return "—";
  return n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div role="radiogroup" className="inline-flex items-center gap-px rounded-md border border-line bg-raise p-px">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`focusable cursor-pointer rounded-sm px-2.5 py-1 text-[12px] whitespace-nowrap transition-colors duration-100 ${
            value === o.id ? "bg-surface font-medium text-fg shadow-[var(--shadow-1)]" : "text-faint hover:text-dim"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const control = "focusable h-8 rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-fg placeholder:text-ghost";

/* ═══════════════════ the panel body ═══════════════════ */

export function AttachedAgents({ onLoaded }: { onLoaded?: (agents: AttachedAgent[], store: string) => void }) {
  const [agents, setAgents] = useState<AttachedAgent[] | null>(null);
  const [store, setStore] = useState("");
  const [mode, setMode] = useState<AttachMode>("sdk");
  const [language, setLanguage] = useState<Language>("python");

  const [name, setName] = useState("");
  const [framework, setFramework] = useState("langgraph");
  const [owner, setOwner] = useState("");
  const [cardUrl, setCardUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [minted, setMinted] = useState<{ agent: AttachedAgent; key: string } | null>(null);
  const [confirming, setConfirming] = useState("");
  const [registry, setRegistry] = useState<{ name: string; server: string; label: string; tool: string; description: string; risk: string }[]>([]);
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState<PolicyDraft>({ grants: [], gate_at: "", injection: "block", secret_name: "", model: "", models: [], fallbacks: [], limits: {} });
  /** The deployment's offered models and tiers, for the routing picker. */
  const [catalogue, setCatalogue] = useState<{ models: string[]; tiers: Record<string, string> }>({ models: [], tiers: {} });
  const [saving, setSaving] = useState(false);
  const [policyError, setPolicyError] = useState("");
  /** Why grants or the gate should change, and when: a policy change carries both. */
  const [reason, setReason] = useState("");
  const [effective, setEffective] = useState("");
  const [proposed, setProposed] = useState<PolicyChange | null>(null);
  const [proposals, setProposals] = useState(0);

  const shown = (d: Pick<AttachedList, "agents" | "store">) => {
    // Every row is as the door answers it: its activity is what the backend measured from the run record.
    const list = d.agents as AttachedAgent[];
    setAgents(list);
    setStore(d.store);
    onLoaded?.(list, d.store);
  };
  const load = () =>
    listAttached()
      .then(shown)
      // A refusal reads as an empty register, as it always has.
      .catch(() => shown({ agents: [], store: "" }));
  useEffect(() => {
    load();
    attachableTools()
      .then(setRegistry)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Resolves whether the change was taken; a refusal stays on the page (the policy editor's own line when it is open). */
  const patch = async (id: string, body: Omit<PolicyPatch, "id">): Promise<boolean> => {
    setSaving(true);
    setPolicyError("");
    try {
      await setAttachedPolicy({ id, ...body });
      await load();
      return true;
    } catch (e) {
      if (editing === id) setPolicyError((e as Error).message);
      else setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    let live = true;
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { models?: { id: string }[]; class_defaults?: Record<string, string> } | null) => {
        if (live && c) setCatalogue({ models: (c.models ?? []).map((m) => m.id), tiers: c.class_defaults ?? {} });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const openPolicy = (a: AttachedAgent) => {
    setEditing(a.id);
    setPolicyError("");
    setReason("");
    setEffective("");
    setProposed(null);
    setDraft({
      grants: a.grants,
      gate_at: a.gate_at,
      injection: a.injection,
      secret_name: a.secret_name ?? "",
      model: a.model ?? "",
      models: a.models ?? [],
      fallbacks: a.fallbacks ?? [],
      limits: a.limits ?? {},
    });
  };
  /** Saves the row's own fields at once and proposes the rest. A refusal (a 409 naming the policy door among them) stays on the editor, in the door's words. */
  const savePolicy = async (a: AttachedAgent) => {
    const { reviewed: proposal, direct } = attachedSplit(a, draft);
    const reviewing = Object.keys(proposal).length > 0;
    if (reviewing && !reason.trim()) return setPolicyError("Grants, the gate, routing and limits go to review: say why.");
    if (Object.keys(direct).length && !(await patch(a.id, direct as Omit<PolicyPatch, "id">))) return;
    if (!reviewing) return setEditing("");
    setSaving(true);
    setPolicyError("");
    try {
      setProposed(await proposePolicyChange({ target: { kind: "attached", id: a.id }, proposed: proposal, effective_at: effectiveAt(effective), reason: reason.trim() }));
      // Proposed is not applied: the editor goes back to the rules as they stand, and the proposal waits above it.
      setDraft((d) => ({ ...d, grants: a.grants, gate_at: a.gate_at, model: a.model ?? "", models: a.models ?? [], fallbacks: a.fallbacks ?? [], limits: a.limits ?? {} }));
      setReason("");
      setEffective("");
      setProposals((n) => n + 1);
    } catch (e) {
      setPolicyError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const frameworks = useMemo(
    () => (mode === "sdk" ? FRAMEWORKS.filter((f) => !f.a2aOnly) : [...FRAMEWORKS.filter((f) => f.a2aOnly), ...FRAMEWORKS.filter((f) => !f.a2aOnly)]),
    [mode],
  );
  /* A framework implies a language; a mode narrows the frameworks. Both are
     settled in the handlers, so nothing here is derived after the fact. */
  const changeFramework = (id: string) => {
    setFramework(id);
    const lang = FRAMEWORK_BY_ID.get(id)?.language;
    if (lang) setLanguage(lang);
  };
  const changeMode = (m: AttachMode) => {
    setMode(m);
    // Each mode opens on the kind of agent it is usually for: a coded one for
    // the SDK, a configured product for A2A. Either can still pick the other.
    const current = FRAMEWORK_BY_ID.get(framework);
    if (m === "sdk" && (!current || current.a2aOnly)) changeFramework("langgraph");
    if (m === "a2a" && (!current || !current.a2aOnly)) changeFramework("copilot-studio");
  };

  /* The snippet carries the agent just attached — or the one being typed. */
  const ctx = useMemo(
    () => ({
      agent: minted?.agent.id ?? (name.trim() ? slugOf(name) || "my-agent" : "my-agent"),
      key: minted?.key ?? "",
    }),
    [minted, name],
  );

  const attach = async () => {
    setBusy(true);
    setError("");
    try {
      const d = await attachAgent({ name, mode, framework, language, owner, card_url: cardUrl });
      setMinted({ agent: d.agent as AttachedAgent, key: d.key });
      setName("");
      setOwner("");
      setCardUrl("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const detach = async (id: string) => {
    setConfirming("");
    await detachAgent(id).catch(() => {});
    if (minted?.agent.id === id) setMinted(null);
    await load();
  };

  const counts = {
    total: agents?.length ?? 0,
    sdk: agents?.filter((a) => a.mode === "sdk").length ?? 0,
    a2a: agents?.filter((a) => a.mode === "a2a").length ?? 0,
  };

  return (
    <div className="flex flex-col">
      {/* ── the way in ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <Seg value={mode} onChange={changeMode} options={MODES.map((m) => ({ id: m, label: MODE_META[m].label }))} />
        <span className="min-w-0 max-w-[62ch] text-[11px] leading-[1.5] text-faint">{MODE_META[mode].blurb}</span>
        <span className="grow" />
        <span className="tnum whitespace-nowrap text-[10.5px] text-ghost">
          {agents ? `${counts.total} attached · ${counts.sdk} over the SDK · ${counts.a2a} over A2A` : "reading the registry…"}
        </span>
      </div>

      {mode === "sdk" ? (
        <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col bg-surface">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2">
              <Seg value={language} onChange={setLanguage} options={LANGUAGES.map((l) => ({ id: l.id, label: l.label }))} />
              <Mono className="min-w-0 truncate text-[10.5px] text-faint">{LANGUAGES.find((l) => l.id === language)?.install}</Mono>
              <span className="grow" />
              <CopyButton text={SNIPPETS[language](ctx)} />
            </div>
            <Code text={SNIPPETS[language](ctx)} lang={language} />
            <span className="border-t border-line px-4 py-2.5 text-[11px] leading-[1.55] text-faint">
              The SDK never carries policy of its own. Every tool call is asked of this control plane before it runs, every gate suspends here and is answered in the console, and the run record lands in the same store as the factory&rsquo;s own. Reports to <Mono className="text-[10.5px]">{ENDPOINTS.ingest}</Mono>.
            </span>
          </div>
          <div className="flex min-w-0 flex-col bg-surface">
            <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">What the factory records</span>
            {RECORDED.map((r) => (
              <span key={r.kind} className="flex items-start gap-3 border-b border-line px-4 py-2">
                <Mono className="w-[168px] shrink-0 pt-px text-[10.5px] text-fg">{r.kind}</Mono>
                <span className="min-w-0 grow text-[11px] leading-[1.5] text-faint">{r.what}</span>
              </span>
            ))}
            <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">Where it then shows</span>
            {SHOWN_ON.map((s) => (
              <span key={s.page} className="flex items-start gap-3 border-b border-line px-4 py-2 last:border-0">
                <span className="w-[168px] shrink-0 text-[11.5px] text-fg">{s.page}</span>
                <span className="min-w-0 grow text-[11px] leading-[1.5] text-faint">{s.what}</span>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col bg-surface">
            {A2A_STEPS.map((s, i) => (
              <div key={s.title} className="flex flex-col border-b border-line last:border-0">
                <div className="flex items-start gap-3 px-4 pt-3 pb-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded-sm bg-ink text-[10.5px] font-semibold text-on-ink">{i + 1}</span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[12px] font-semibold text-fg">{s.title}</span>
                    <span className="max-w-[78ch] text-[11px] leading-[1.55] text-faint">{s.body}</span>
                  </span>
                  <span className="grow" />
                  {s.snippet && <CopyButton text={s.snippet(ctx)} />}
                </div>
                {s.snippet && <Code text={s.snippet(ctx)} lang={s.lang ?? "http"} className="border-t border-line bg-raise/40" />}
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-col bg-surface">
            <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">Enforced at the gateway, without a line of the agent&rsquo;s code</span>
            {[
              { k: "Capability", v: "a tool the agent was never granted is refused, and the refusal is recorded" },
              { k: "Scope", v: "which rows of a granted tool it may touch, enforced on the call" },
              { k: "Taint", v: "everything a tainting tool returns is marked, and cannot reach a sink" },
              { k: "Gates", v: "a call at or above the gate risk waits for a named person" },
              { k: "Injection", v: "prompts are screened before they leave for the model" },
              { k: "Kill switch", v: "an operator kill refuses the agent's next model call" },
              { k: "Cost", v: "every completion priced from the model sheet, never estimated" },
            ].map((r) => (
              <span key={r.k} className="flex items-start gap-3 border-b border-line px-4 py-2">
                <span className="w-[92px] shrink-0 text-[11.5px] text-fg">{r.k}</span>
                <span className="min-w-0 grow text-[11px] leading-[1.5] text-faint">{r.v}</span>
              </span>
            ))}
            <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">Known to attach this way</span>
            <span className="flex flex-wrap gap-1.5 px-4 py-3">
              {FRAMEWORKS.filter((f) => f.a2aOnly).map((f) => (
                <Tag key={f.id} tone="queue">{f.label}</Tag>
              ))}
              {FRAMEWORKS.filter((f) => !f.a2aOnly && f.id !== "custom").map((f) => (
                <Tag key={f.id}>{f.label}</Tag>
              ))}
            </span>
            <span className="border-t border-line px-4 py-2.5 text-[11px] leading-[1.55] text-faint">
              Any agent that honours an OpenAI-compatible base URL and an MCP configuration attaches this way. The factory&rsquo;s own card is at <Mono className="text-[10.5px]">{ENDPOINTS.card}</Mono>.
            </span>
          </div>
        </div>
      )}

      {/* ── attach ── */}
      <form
        className="flex flex-wrap items-end gap-2 border-t border-line bg-raise/40 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && name.trim()) attach();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] text-ghost">Agent</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" className={`${control} w-[190px]`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] text-ghost">Attach over</span>
          <span className="block w-[170px]">
            <Pick value={mode} onChange={changeMode} options={MODES.map((m) => ({ value: m, label: MODE_META[m].label }))} aria-label="Attach over" />
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] text-ghost">Framework</span>
          <span className="block w-[210px]">
            <Pick value={framework} onChange={changeFramework} options={frameworks.map((f) => ({ value: f.id, label: f.label }))} aria-label="Framework" />
          </span>
        </label>
        {mode === "sdk" ? (
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] text-ghost">Language</span>
            <span className="block w-[140px]">
              <Pick value={language} onChange={setLanguage} options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} aria-label="Language" />
            </span>
          </label>
        ) : (
          <label className="flex min-w-0 grow flex-col gap-1">
            <span className="text-[10.5px] text-ghost">Agent card URL</span>
            <input value={cardUrl} onChange={(e) => setCardUrl(e.target.value)} placeholder="https://…/.well-known/agent.json" className={`${control} w-full min-w-[220px] font-mono text-[11px]`} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] text-ghost">Owner</span>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Owning team" className={`${control} w-[160px]`} />
        </label>
        <Button type="submit" variant="solid" tone="ink" size="sm" permission="configure" disabled={!name.trim() || store === "db unreachable"} loading={busy}>
          Attach
        </Button>
        {name.trim() && <Mono className="pb-1.5 text-[10.5px] text-ghost">id · {slugOf(name) || "—"}</Mono>}
        {error && <span className="basis-full text-[11px] text-err">{error}</span>}
        {minted && (
          <div className="mt-1 flex basis-full flex-wrap items-center gap-3 rounded-sm border border-ok-line bg-ok-bg px-3 py-2">
            <Status tone="ok">{minted.agent.name} attached</Status>
            <Mono className="text-[11px] text-fg">{minted.key}</Mono>
            <CopyButton text={minted.key} />
            <span className="text-[10.5px] text-faint">This is the only time the key is shown. The snippet above already carries it.</span>
            <span className="grow" />
            <Button size="sm" variant="solid" tone="neutral" onClick={() => setMinted(null)}>Dismiss</Button>
          </div>
        )}
      </form>

      {/* ── the registry ── */}
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[980px] border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] text-faint">
              <th className="px-4 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 font-medium">Attached over</th>
              <th className="px-3 py-2 font-medium">Enforcement</th>
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">Last seen</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Runs · 30d</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Cost · 30d</th>
              <th className="px-3 py-2 text-right font-medium">Denials</th>
              <th className="px-3 py-2 text-right font-medium">Gates</th>
              <th className="px-3 py-2 text-right font-medium">p50</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(agents ?? []).map((a) => {
              const fw = FRAMEWORK_BY_ID.get(a.framework)?.label ?? a.framework;
              const lang = LANGUAGES.find((l) => l.id === a.language)?.label;
              return (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="flex flex-col">
                      <span className="text-[12px] text-fg">{a.name}</span>
                      <span className="font-mono text-[10px] text-faint">{a.id} · key {a.key_prefix}…</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex flex-col gap-1">
                      <span className="flex items-center gap-1.5">
                        {a.mode === "sdk" ? <Tag tone="run" solid>SDK</Tag> : <Tag tone="queue" solid>A2A</Tag>}
                        <span className="text-[11px] text-fg">{fw}</span>
                      </span>
                      <span className="max-w-[240px] truncate font-mono text-[10px] text-ghost">
                        {a.mode === "sdk" ? `${lang ?? "SDK"} · in-process` : a.card_url ? host(a.card_url) : "gateway + broker"}
                      </span>
                      {(a.mode === "a2a" || a.secret_name) && (
                        <span
                          className={`max-w-[240px] truncate text-[10px] ${a.secret_name ? "text-faint" : "text-warn"}`}
                          title={a.secret_name ? `It signs its A2A requests as ${a.id} with the vault secret named ${a.secret_name}; the value never leaves the vault.` : "No A2A secret: the tasks door does not hear it until its policy names one."}
                        >
                          {a.secret_name ? (
                            <>
                              signs A2A with <Mono className="text-[10px] text-dim">{a.secret_name}</Mono>
                            </>
                          ) : (
                            "no A2A secret named"
                          )}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {a.blocked ? <Status tone="err">blocked</Status> : <Status tone="ok">enforced</Status>}
                    <span className="block text-[10px] text-ghost">
                      {a.blocked ? "every door refuses" : `${a.model ? `routes to ${a.model} · ` : ""}${MODE_META[a.mode].enforcement} · ${a.grants.length} tool${a.grants.length === 1 ? "" : "s"} · gate ${a.gate_at || "never"}`}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-[11.5px]">{a.owner || <span className="text-ghost">unowned</span>}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-[11px] text-faint">
                    {a.last_seen ? ago(a.last_seen) : <span className="text-ghost">awaiting first run</span>}
                  </td>
                  <td className="tnum px-3 py-2.5 text-right whitespace-nowrap">{a.runs30d || <span className="text-ghost">0</span>}</td>
                  <td className="tnum px-3 py-2.5 text-right whitespace-nowrap">{money(a.cost30d, a.runs30d)}</td>
                  <td className="tnum px-3 py-2.5 text-right">{a.denials30d ? <span className="text-warn">{a.denials30d}</span> : <span className="text-ghost">0</span>}</td>
                  <td className="tnum px-3 py-2.5 text-right">{a.gates30d === null ? <span className="text-ghost">—</span> : a.gates30d}</td>
                  <td className="tnum px-3 py-2.5 text-right whitespace-nowrap text-faint">{a.p50ms === null ? <span className="text-ghost">—</span> : a.p50ms >= 1000 ? `${(a.p50ms / 1000).toFixed(1)} s` : `${a.p50ms} ms`}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {confirming === a.id ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Button size="sm" variant="solid" tone="err" permission="configure" onClick={() => detach(a.id)}>Detach and revoke key</Button>
                        <Button size="sm" variant="solid" tone="neutral" onClick={() => setConfirming("")}>Keep</Button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <Button size="sm" variant="solid" tone="neutral" permission="configure" onClick={() => (editing === a.id ? setEditing("") : openPolicy(a))} disabled={store === "db unreachable"}>
                          {editing === a.id ? "Close" : "Policy"}
                        </Button>
                        <Button size="sm" variant="solid" tone={a.blocked ? "ok" : "warn"} permission="configure" onClick={() => patch(a.id, { blocked: !a.blocked })} disabled={store === "db unreachable" || saving}>
                          {a.blocked ? "Unblock" : "Block"}
                        </Button>
                        <Button size="sm" variant="solid" tone="err" permission="configure" onClick={() => setConfirming(a.id)} disabled={store === "db unreachable"}>
                          Detach
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            }).flatMap((row) => {
              const a = (agents ?? []).find((x) => x.id === row.key);
              if (!a || editing !== a.id) return [row];
              const servers = [...new Map(registry.map((t) => [t.server, t.label])).entries()];
              const toggle = (name: string) =>
                setDraft((d) => ({ ...d, grants: d.grants.includes(name) ? d.grants.filter((g) => g !== name) : [...d.grants, name] }));
              return [
                row,
                <tr key={`${a.id}-policy`} className="border-b border-line bg-raise/30">
                  <td colSpan={11} className="px-4 py-3">
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <span className="text-[12px] font-semibold text-fg">Policy for {a.name}</span>
                        <span className="text-[11px] text-faint">Enforced at the tool broker and the model gateway. An agent starts with nothing granted.</span>
                        <span className="grow" />
                        <label className="flex flex-col gap-1">
                          <span className="text-[10.5px] text-ghost">Gate at</span>
                          <span className="block w-[180px]">
                            <Pick
                              value={draft.gate_at}
                              onChange={(v) => setDraft((d) => ({ ...d, gate_at: v }))}
                              options={[
                                { value: "" as AttachedAgent["gate_at"], label: "never" },
                                { value: "read", label: "read and above" },
                                { value: "write", label: "write and above" },
                                { value: "risky", label: "risky and above" },
                                { value: "destructive", label: "destructive only" },
                              ]}
                              aria-label="Gate at"
                            />
                          </span>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10.5px] text-ghost">Injection filter</span>
                          <span className="block w-[190px]">
                            <Pick
                              value={draft.injection}
                              onChange={(v) => setDraft((d) => ({ ...d, injection: v }))}
                              options={[
                                { value: "block" as AttachedAgent["injection"], label: "block the prompt" },
                                { value: "flag", label: "record and continue" },
                              ]}
                              aria-label="Injection filter"
                            />
                          </span>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10.5px] text-ghost">A2A secret (vault name)</span>
                          <input
                            value={draft.secret_name}
                            onChange={(e) => setDraft((d) => ({ ...d, secret_name: e.target.value }))}
                            placeholder={`${a.id}-a2a`}
                            spellCheck={false}
                            aria-label="A2A secret, by its vault name"
                            className={`${control} w-[190px] font-mono text-[11px]`}
                          />
                        </label>
                        <Button
                          size="sm"
                          variant="solid"
                          tone="ink"
                          permission="configure"
                          loading={saving}
                          disabled={Boolean(effectiveProblem(effective))}
                          onClick={() => savePolicy(a)}
                        >
                          {Object.keys(attachedSplit(a, draft).reviewed).length ? "Propose for review" : "Save"}
                        </Button>
                        <Button size="sm" variant="solid" tone="err" onClick={() => setEditing("")}>Cancel</Button>
                      </div>
                      <ModelRouting draft={draft} onChange={setDraft} catalogue={catalogue} control={control} />
                      <span className="text-[10.5px] leading-[1.5] text-faint">
                        The A2A secret is the name the vault holds it under (or <Mono className="text-[10px]">{"${secret:name}"}</Mono>), never the secret itself: the agent signs every A2A request with it as <Mono className="text-[10px]">{a.id}</Mono>, and one name signs for one caller, peer or agent. Leave it empty to remove it.
                      </span>
                      <span className="text-[10.5px] leading-[1.5] text-faint">
                        The gate, the grants, routing and limits go to review: someone other than you approves them on the Policy page, and they stand as they are until then. The injection filter and the A2A secret apply at once.
                      </span>
                      <OpenChanges target={{ kind: "attached", id: a.id }} tick={proposals} />
                      {Object.keys(attachedSplit(a, draft).reviewed).length > 0 && <ProposalNote reason={reason} onReason={setReason} effective={effective} onEffective={setEffective} />}
                      {proposed && (
                        <Link href={`/policy?change=${encodeURIComponent(proposed.id)}`} className="focusable w-fit rounded-sm text-[11px] text-ok hover:underline">
                          {proposedLine(proposed)}
                        </Link>
                      )}
                      {policyError && <span className="text-[11px] text-err">{policyError}</span>}
                      <div className="grid gap-px overflow-hidden rounded-sm border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
                        {servers.map(([server, label]) => (
                          <div key={server} className="flex flex-col bg-surface">
                            <span className="flex items-center gap-2 border-b border-line px-3 py-1.5">
                              <span className="min-w-0 truncate text-[11px] font-semibold text-fg">{label}</span>
                              <Mono className="shrink-0 text-[10px] text-ghost">{server}</Mono>
                            </span>
                            {registry.filter((t) => t.server === server).map((t) => (
                              <label key={t.name} className="flex cursor-pointer items-start gap-2 border-b border-line px-3 py-1.5 last:border-0 hover:bg-raise/40">
                                <input type="checkbox" checked={draft.grants.includes(t.name)} onChange={() => toggle(t.name)} className="mt-0.5 accent-[var(--t-fg)]" />
                                <span className="flex min-w-0 flex-col">
                                  <span className="flex items-center gap-1.5">
                                    <Mono className="text-[10.5px] text-fg">{t.tool}</Mono>
                                    <Tag tone={t.risk === "read" ? "ok" : t.risk === "destructive" ? "err" : "warn"}>{t.risk}</Tag>
                                  </span>
                                  <span className="line-clamp-1 text-[10px] text-ghost">{t.description}</span>
                                </span>
                              </label>
                            ))}
                          </div>
                        ))}
                        {registry.length === 0 && <span className="bg-surface px-3 py-2 text-[11px] text-faint">No tool server&rsquo;s tools are on offer yet; register one under Tool servers on this page, and its tools appear here once its pin is approved.</span>}
                      </div>
                    </div>
                  </td>
                </tr>,
              ];
            })}
            {agents && agents.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-3 text-[11.5px] text-faint">No third-party agent is attached. The first one appears here with its key.</td>
              </tr>
            )}
            {!agents && (
              <tr>
                <td colSpan={11} className="px-4 py-3 text-[11.5px] text-faint">Reading the registry…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {store === "db unreachable" && (
        <p className="border-t border-line px-4 py-2 text-[10.5px] text-warn">The registry database is unreachable; attaching is disabled until it answers.</p>
      )}
    </div>
  );
}
