"use client";
import { useDoorOff } from "@/lib/use-doors";
import { errorText } from "@/lib/api/client";
import { Failure } from "./pending";

import { useEffect, useMemo, useState } from "react";
import { useMachineOrigin, useSession } from "@/lib/use-session";
import { machineAddress, machineLine } from "@/lib/site";
import Link from "next/link";
import { Button, Mono, Status, Tag } from "./ui";
import { Pick } from "./select";
import { Code, CopyButton } from "./code";
import { OpenChanges, ProposalNote } from "./policy";
import {
  A2A_STEPS,
  PATHS,
  readA2AOrigin,
  FRAMEWORKS,
  FRAMEWORK_BY_ID,
  LANGUAGES,
  MODE_META,
  RECORDED,
  SHOWN_ON,
  SNIPPETS,
  isSnippetLanguage,
  slugOf,
  type AgentLimits,
  type AttachMode,
  type AttachedAgent,
  type AttachedRow,
  type SnippetLanguage,
} from "@/lib/attached";
import { approveAttached, attachAgent, attachableTools, detachAgent, listAttached, setAttachedPolicy, type AttachedList, type AttachedPatch } from "@/lib/api/l2";
import { proposePolicyChange, type PolicyChange } from "@/lib/api/l9";
import { attachedSplit, effectiveAt, effectiveProblem, proposedLine } from "@/lib/policy";

/**
 * Third-party agents: how one attaches, and which ones have.
 *
 * The manual (the Python and TypeScript SDKs, or the gateway and broker
 * route for an agent whose code cannot change) sits behind "Show the code",
 * so the panel opens on the attach form and the registry. It renders with the
 * id and key of whatever was just attached, so the snippet on screen is the
 * one to paste, and it opens by itself when a key is minted. The registry is
 * every attached agent with its approval, its policy and its activity.
 *
 * An attachment waits for a second person's approval before its key works.
 * Until then its policy editor saves every field at once (and whoever saves
 * it cannot approve it); after approval the grants, the gate, routing and
 * limits go to review as a policy change, and the injection filter and the
 * block still save at once.
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
function ModelRouting({ draft, onChange, catalogue, control, catalogueError = "" }: {
  draft: PolicyDraft;
  onChange: (update: (d: PolicyDraft) => PolicyDraft) => void;
  catalogue: { models: string[]; tiers: Record<string, string> };
  control: string;
  /** Why the deployment's models were not read: the picker then offers only the default and the agent's own choice, and says so. */
  catalogueError?: string;
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
      {catalogueError && <Failure inline message={`The deployment's models and tiers could not be read (GET /api/config: ${catalogueError}), so the picker offers only the deployment's default and this agent's own choice.`} />}
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
  if (n === null) return "no price set";
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

/** In place of a snippet that names a door, where the deployment names no machine origin (or the session is still read). */
function NoMachineCode({ machine, consequence, className = "" }: { machine: string | null | undefined; consequence: string; className?: string }) {
  return (
    <p className={`px-4 py-3 text-[11.5px] leading-[1.55] ${machine === undefined ? "text-faint" : "text-warn"} ${className}`}>
      {machineLine(machine, "", consequence)}
      {machine === null && " The code is shown once the deployment names that address."}
    </p>
  );
}

type A2AOrigin = { origin: string | null; problem: string } | { failed: string } | null;

/**
 * The factory's own A2A card, and which setting its address comes from: A2A_PUBLIC_URL, the address peers reach this
 * platform at and sign their requests for, when the backend names it; else the machine origin, said as such.
 */
function CardLine({ a2a, machine }: { a2a: A2AOrigin; machine: string | null | undefined }) {
  const mono = "text-[10.5px]";
  if (!a2a || machine === undefined) return <>Reading where peers reach the factory&rsquo;s card&hellip;</>;
  if ("origin" in a2a && a2a.origin) {
    return (
      <>
        The factory&rsquo;s own card is at <Mono className={mono}>{a2a.origin + PATHS.card}</Mono> (A2A_PUBLIC_URL, the address peers reach this platform at).
      </>
    );
  }
  // The platform's own reason when A2A_PUBLIC_URL is not set: the card is not served until it is.
  const why = "failed" in a2a ? `whether A2A_PUBLIC_URL is set could not be read: ${a2a.failed}` : a2a.problem || "A2A_PUBLIC_URL is not set, and the platform serves no card until it is";
  if (machine) {
    return (
      <>
        Shown at the machine address (PUBLIC_API_URL), the factory&rsquo;s own card is <Mono className={mono}>{machine + PATHS.card}</Mono>; {why}.
      </>
    );
  }
  return <>No address peers reach this platform at is set on this deployment (A2A_PUBLIC_URL or PUBLIC_API_URL): peers cannot read the factory&rsquo;s card through the console&rsquo;s sign-in.</>;
}

/* ═══════════════════ the panel body ═══════════════════ */

export function AttachedAgents({ onLoaded }: { onLoaded?: (agents: AttachedAgent[], store: string) => void }) {
  const [agents, setAgents] = useState<AttachedAgent[] | null>(null);
  const [store, setStore] = useState("");
  /** Why the register's read failed, when it did: shown in place of the register and its counts. */
  const [unread, setUnread] = useState("");
  const [mode, setMode] = useState<AttachMode>("sdk");
  const attachDoor = useDoorOff("POST", "/api/attached");
  const [language, setLanguage] = useState<SnippetLanguage>("python");
  const { session } = useSession();
  /** The install line, the snippets and the setup steps are folded away until asked for. */
  const [code, setCode] = useState(false);
  /** The origin the agent calls the platform at (the session's machineOrigin), never the console's own. */
  const machine = useMachineOrigin();
  const unreachable = "an attached agent cannot reach the platform";
  /** Where peers reach this platform over A2A (A2A_PUBLIC_URL), as `GET /api/a2a` answers it; read when the code is first shown. */
  const [a2a, setA2a] = useState<A2AOrigin>(null);

  const [name, setName] = useState("");
  const [framework, setFramework] = useState("langgraph");
  const [owner, setOwner] = useState("");
  const [cardUrl, setCardUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [minted, setMinted] = useState<{ agent: AttachedAgent; key: string } | null>(null);
  const [confirming, setConfirming] = useState("");
  /** A detach the platform refused or failed: the key is not revoked, and the row says why. */
  const [detachError, setDetachError] = useState<{ id: string; message: string } | null>(null);
  const [detaching, setDetaching] = useState("");
  const [registry, setRegistry] = useState<{ name: string; server: string; label: string; tool: string; description: string; risk: string }[]>([]);
  /** Why the tools on offer were not read; the grant list says so instead of "none on offer". */
  const [registryError, setRegistryError] = useState("");
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState<PolicyDraft>({ grants: [], gate_at: "", injection: "block", secret_name: "", model: "", models: [], fallbacks: [], limits: {} });
  /** The deployment's offered models and tiers, for the routing picker. */
  const [catalogue, setCatalogue] = useState<{ models: string[]; tiers: Record<string, string> }>({ models: [], tiers: {} });
  const [catalogueError, setCatalogueError] = useState("");
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
      .then((d) => {
        setUnread("");
        shown(d);
      })
      // A refusal is shown as the failure it is, never as an empty register.
      .catch((e) => {
        setUnread((e as Error).message);
        shown({ agents: [], store: "" });
      });
  useEffect(() => {
    if (!code || a2a) return;
    readA2AOrigin()
      .then(setA2a)
      .catch((e) => setA2a({ failed: (e as Error).message }));
  }, [code, a2a]);
  useEffect(() => {
    load();
    attachableTools()
      .then((t) => {
        setRegistry(t);
        setRegistryError("");
      })
      .catch((e) => setRegistryError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Resolves whether the change was taken; a refusal stays on the page (the policy editor's own line when it is open). */
  const patch = async (id: string, body: Omit<AttachedPatch, "id">): Promise<boolean> => {
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
      .then(async (r) => {
        const c = await r.json().catch(() => null);
        if (!r.ok || !c) throw new Error(r.ok ? "the answer could not be read" : errorText(c, r, "GET", "/api/config"));
        return c as { models?: { id: string }[]; class_defaults?: Record<string, string> };
      })
      .then((c) => {
        if (!live) return;
        setCatalogue({ models: (c.models ?? []).map((m) => m.id), tiers: c.class_defaults ?? {} });
        setCatalogueError("");
      })
      .catch((e) => live && setCatalogueError((e as Error).message));
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
  /** Whether this person attached the agent or changed its policy before approval: such a person cannot approve it. */
  const proposedByMe = (a: AttachedRow) =>
    Boolean(session?.email) && (a.approval?.proposed_by ?? []).some((p) => p.toLowerCase() === session?.email.toLowerCase());
  const awaiting = (a: AttachedRow) => a.approval?.state !== "approved";

  const approve = async (a: AttachedRow) => {
    setSaving(true);
    setError("");
    try {
      await approveAttached(a.id, a.policy_digest ?? a.approval?.digest ?? "");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Before approval every field is saved at once. After it, the row's own fields are saved and the rest proposed.
   * A refusal (a 409 naming the policy door among them) stays on the editor, in the door's words.
   */
  const savePolicy = async (a: AttachedAgent) => {
    if (awaiting(a)) {
      const { grants, gate_at, injection, model, models, fallbacks, limits } = draft;
      const sorted = Object.fromEntries(Object.entries(limits).filter(([, v]) => typeof v === "number" && v > 0)) as Record<string, number>;
      if (await patch(a.id, { grants, gate_at, injection, model, models, fallbacks, limits: sorted })) setEditing("");
      return;
    }
    const { reviewed: proposal, direct } = attachedSplit(a, draft);
    const reviewing = Object.keys(proposal).length > 0;
    if (reviewing && !reason.trim()) return setPolicyError("Grants, the gate, routing and limits go to review: say why.");
    if (Object.keys(direct).length && !(await patch(a.id, direct as Omit<AttachedPatch, "id">))) return;
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
    // Only a language a tested SDK exists in; otherwise the choice stands.
    if (lang && isSnippetLanguage(lang)) setLanguage(lang);
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
      origin: machine ?? "",
    }),
    [minted, name, machine],
  );

  const attach = async () => {
    setBusy(true);
    setError("");
    try {
      const d = await attachAgent({ name, mode, framework, language, owner, card_url: cardUrl });
      setMinted({ agent: d.agent as AttachedAgent, key: d.key });
      // The snippet now carries the new agent's id and key: show it.
      setCode(true);
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
    setDetaching(id);
    setDetachError(null);
    try {
      await detachAgent(id);
    } catch (e) {
      // The key is not revoked: the confirm and the minted key's banner stay, with the platform's reason.
      setDetachError({ id, message: (e as Error).message });
      setDetaching("");
      return;
    }
    setDetaching("");
    setConfirming("");
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
          {unread ? "" : agents ? `${counts.total} attached · ${counts.sdk} over the SDK · ${counts.a2a} over A2A` : "reading the registry…"}
        </span>
        <Button size="sm" variant="solid" tone="neutral" onClick={() => setCode(!code)}>
          {code ? "Hide the code" : "Show the code"}
        </Button>
      </div>

      {!code ? null : mode === "sdk" ? (
        <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col bg-surface">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2">
              <Seg value={language} onChange={setLanguage} options={LANGUAGES.map((l) => ({ id: l.id, label: l.label }))} />
              <Mono className="min-w-0 truncate text-[10.5px] text-faint">{LANGUAGES.find((l) => l.id === language)?.install}</Mono>
              <span className="grow" />
              {machine && <CopyButton text={SNIPPETS[language](ctx)} />}
            </div>
            {machine ? <Code text={SNIPPETS[language](ctx)} lang={language} /> : <NoMachineCode machine={machine} consequence={unreachable} />}
            <span className="border-t border-line px-4 py-2.5 text-[11px] leading-[1.55] text-faint">
              The SDK carries no policy of its own. Every tool call goes through the broker and is decided here before it is made, every gate waits here and is answered on the Approvals page, and the run&rsquo;s record lands in the same store as the factory&rsquo;s own.
              {machine && (
                <>
                  {" "}Runs open at <Mono className="text-[10.5px]">{machineAddress(machine, PATHS.ingest)}</Mono>, the platform&rsquo;s own address, outside the console&rsquo;s sign-in.
                </>
              )}{" "}
              Go, Java and C# have a reference of the wire format (sdk/WIRE.md), not a tested SDK.
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
                  {s.snippet && (machine || !s.machine) && <CopyButton text={s.snippet(ctx)} />}
                </div>
                {s.snippet && (machine || !s.machine) && <Code text={s.snippet(ctx)} lang={s.lang ?? "http"} className="border-t border-line bg-raise/40" />}
                {s.snippet && s.machine && !machine && <NoMachineCode machine={machine} consequence={unreachable} className="border-t border-line" />}
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-col bg-surface">
            <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">Enforced at the gateway and the broker, without a line of the agent&rsquo;s code</span>
            {[
              { k: "Capability", v: "a tool the agent was never granted is refused, and the refusal is recorded" },
              { k: "Scope", v: "the argument values a granted tool may be called with, enforced on the call" },
              { k: "Taint", v: "what an untrusted tool returns is marked; from then on no tool that acts outside is called in that run" },
              { k: "Gates", v: "a call at or above the gate risk waits for a person on the Approvals page" },
              { k: "Injection", v: "prompts are screened before they leave for the model" },
              { k: "Stop", v: "a stopped run's next model or tool call is refused" },
              { k: "Cost", v: "every completion priced at the configured price; a model with no price shows as unpriced" },
            ].map((r) => (
              <span key={r.k} className="flex items-start gap-3 border-b border-line px-4 py-2">
                <span className="w-[92px] shrink-0 text-[11.5px] text-fg">{r.k}</span>
                <span className="min-w-0 grow text-[11px] leading-[1.5] text-faint">{r.v}</span>
              </span>
            ))}
            <span className="px-4 py-2.5 text-[11px] leading-[1.55] text-faint">
              An agent that lets you set an OpenAI-compatible base URL, an MCP server and the headers sent to each can attach this way; none of the products in the framework list has been tried against this platform. Handing this platform tasks over A2A is a separate door: register the agent under Peers. <CardLine a2a={a2a} machine={machine} />
            </span>
          </div>
        </div>
      )}

      {/* ── attach ── */}
      <form
        className={`flex flex-wrap items-end gap-2 bg-raise/40 px-4 py-3 ${code ? "border-t border-line" : ""}`}
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
        <Button type="submit" variant="solid" tone="ink" size="sm" permission="configure" disabled={!name.trim() || store === "db unreachable" || attachDoor.off} title={attachDoor.why} loading={busy}>
          Attach
        </Button>
        {name.trim() && <Mono className="pb-1.5 text-[10.5px] text-ghost">id · {slugOf(name) || "—"}</Mono>}
        {error && (<span className="basis-full text-[11px] text-err">{error}</span>)}
        {minted && (
          <div className="mt-1 flex basis-full flex-wrap items-center gap-3 rounded-sm border border-ok-line bg-ok-bg px-3 py-2">
            <Status tone="ok">{minted.agent.name} attached</Status>
            <Mono className="text-[11px] text-fg">{minted.key}</Mono>
            <CopyButton text={minted.key} />
            <span className="text-[10.5px] text-faint">This is the only time the key is shown; it works once someone else approves the attachment. Set its policy with Policy below before then.</span>
            <span className="grow" />
            <Button size="sm" variant="solid" tone="neutral" onClick={() => setMinted(null)}>Dismiss</Button>
          </div>
        )}
      </form>

      {/* ── the registry: it fits its panel at 1280 px and up, long text wrapping and each row's actions stacking ── */}
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-left align-bottom text-[10.5px] text-faint">
              <th className="py-2 pr-2 pl-4 font-medium">Agent</th>
              <th className="px-2 py-2 font-medium">Attached over</th>
              <th className="px-2 py-2 font-medium">Enforcement</th>
              <th className="px-2 py-2 font-medium">Owner</th>
              <th className="px-2 py-2 font-medium">Last seen</th>
              <th className="px-2 py-2 text-right font-medium">Runs 30d</th>
              <th className="px-2 py-2 text-right font-medium">Cost 30d</th>
              <th className="px-2 py-2 text-right font-medium">Denials</th>
              <th className="px-2 py-2 text-right font-medium">Gates</th>
              <th className="px-2 py-2 text-right font-medium">p50</th>
              <th className="py-2 pr-4 pl-2" />
            </tr>
          </thead>
          <tbody>
            {(agents ?? []).map((a) => {
              const fw = FRAMEWORK_BY_ID.get(a.framework)?.label ?? a.framework;
              const lang = LANGUAGES.find((l) => l.id === a.language)?.label;
              return (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="py-2.5 pr-2 pl-4 align-top">
                    <span className="flex max-w-[200px] min-w-[104px] flex-col">
                      <span className="text-[12px] break-words text-fg">{a.name}</span>
                      <span className="font-mono text-[10px] break-all text-faint">{a.id}</span>
                      <span className="font-mono text-[10px] text-faint">key {a.key_prefix}…</span>
                    </span>
                  </td>
                  <td className="px-2 py-2.5 align-top">
                    <span className="flex flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {a.mode === "sdk" ? <Tag tone="run" solid>SDK</Tag> : <Tag tone="queue" solid>Gateway</Tag>}
                        <span className="text-[11px] text-fg">{fw}</span>
                      </span>
                      <span className="block max-w-[150px] font-mono text-[10px] leading-[1.45] break-words text-ghost">
                        {a.mode === "sdk" ? `${lang ? `${lang} SDK` : "SDK"} · gateway + broker` : a.card_url ? host(a.card_url) : "gateway + broker"}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-2.5 align-top">
                    <span className="whitespace-nowrap">{a.blocked ? <Status tone="err">blocked</Status> : awaiting(a) ? <Status tone="warn">awaiting approval</Status> : <Status tone="ok">enforced</Status>}</span>
                    <span className="mt-0.5 block max-w-[190px] min-w-[120px] text-[10px] leading-[1.45] text-ghost">
                      {a.blocked
                        ? "every door refuses"
                        : `${awaiting(a) ? "key refused until approved · " : ""}${a.model ? `routes to ${a.model} · ` : ""}${MODE_META[a.mode].enforcement} · ${a.grants.length} tool${a.grants.length === 1 ? "" : "s"} · gate ${a.gate_at || "never"}`}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 align-top text-[11.5px] break-words">{a.owner || <span className="text-ghost">unowned</span>}</td>
                  <td className="px-2 py-2.5 align-top text-[11px] text-faint">
                    {a.last_seen ? <span className="whitespace-nowrap">{ago(a.last_seen)}</span> : <span className="text-ghost">awaiting first run</span>}
                  </td>
                  <td className="tnum px-2 py-2.5 text-right align-top whitespace-nowrap">{a.runs30d || <span className="text-ghost">0</span>}</td>
                  <td className="tnum px-2 py-2.5 text-right align-top whitespace-nowrap">{money(a.cost30d, a.runs30d)}</td>
                  <td className="tnum px-2 py-2.5 text-right align-top">{a.denials30d ? <span className="text-warn">{a.denials30d}</span> : <span className="text-ghost">0</span>}</td>
                  <td className="tnum px-2 py-2.5 text-right align-top">{a.gates30d === null ? <span className="text-ghost">—</span> : a.gates30d}</td>
                  <td className="tnum px-2 py-2.5 text-right align-top whitespace-nowrap text-faint">{a.p50ms === null ? <span className="text-ghost">—</span> : a.p50ms >= 1000 ? `${(a.p50ms / 1000).toFixed(1)} s` : `${a.p50ms} ms`}</td>
                  <td className="py-2.5 pr-4 pl-2 text-right align-top">
                    {confirming === a.id ? (
                      <span className="ml-auto flex w-max flex-col items-stretch gap-1.5">
                        <Button size="sm" variant="solid" tone="err" permission="configure" onClick={() => detach(a.id)} loading={detaching === a.id}>Detach and revoke key</Button>
                        <Button
                          size="sm"
                          variant="solid"
                          tone="neutral"
                          onClick={() => {
                            setConfirming("");
                            setDetachError(null);
                          }}
                        >
                          Keep
                        </Button>
                        {detachError?.id === a.id && <span className="max-w-[240px] text-left text-[10.5px] leading-[1.45] whitespace-normal text-err">Not detached, and the key is not revoked: {detachError.message}</span>}
                      </span>
                    ) : (
                      <span className="ml-auto grid w-max grid-cols-2 gap-1.5 [&>*]:justify-center">
                        {awaiting(a) && (
                          <Button
                            size="sm"
                            variant="solid"
                            tone="ok"
                            permission="configure"
                            onClick={() => approve(a)}
                            disabled={saving || proposedByMe(a)}
                            title={proposedByMe(a) ? "You attached this agent or changed its policy, so someone else approves it" : "Approve the attachment exactly as its policy stands now; its key works from then"}
                          >
                            Approve
                          </Button>
                        )}
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
                        <span className="text-[11px] text-faint">Enforced at the tool broker and the model gateway. An agent starts with nothing granted; agent.invoke cannot be granted.</span>
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
                        <Button
                          size="sm"
                          variant="solid"
                          tone="ink"
                          permission="configure"
                          loading={saving}
                          disabled={Boolean(effectiveProblem(effective))}
                          onClick={() => savePolicy(a)}
                        >
                          {!awaiting(a) && Object.keys(attachedSplit(a, draft).reviewed).length ? "Propose for review" : "Save"}
                        </Button>
                        <Button size="sm" variant="solid" tone="err" onClick={() => setEditing("")}>Cancel</Button>
                      </div>
                      <ModelRouting draft={draft} onChange={setDraft} catalogue={catalogue} control={control} catalogueError={catalogueError} />
                      <span className="text-[10.5px] leading-[1.5] text-faint">
                        {awaiting(a)
                          ? "The attachment waits for a second person's approval: every field saves here at once, and whoever saves it cannot approve it. The approval covers the policy exactly as it stands then."
                          : "The gate, the grants, routing and limits go to review: someone other than you approves them on the Policy page, and they stand as they are until then. The injection filter applies at once."}
                      </span>
                      {!awaiting(a) && <OpenChanges target={{ kind: "attached", id: a.id }} tick={proposals} />}
                      {!awaiting(a) && Object.keys(attachedSplit(a, draft).reviewed).length > 0 && <ProposalNote reason={reason} onReason={setReason} effective={effective} onEffective={setEffective} />}
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
                        {registryError ? (
                          <span className="bg-surface px-3 py-2"><Failure inline message={`The tools on offer could not be read, so none can be granted here until they are: ${registryError}`} /></span>
                        ) : (
                          registry.length === 0 && <span className="bg-surface px-3 py-2 text-[11px] text-faint">No tool server&rsquo;s tools are on offer yet; register one under Tool servers on this page, and its tools appear here once its pin is approved.</span>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>,
              ];
            })}
            {agents && agents.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-3 text-[11.5px] text-faint">{unread ? <Failure what="The third-party agents could not be read" message={unread} /> : "No third-party agent is attached. The first one appears here with its key."}</td>
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
