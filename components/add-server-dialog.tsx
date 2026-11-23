"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { Field, Input, Textarea } from "./forms";
import { Pick } from "./select";
import { DigestChip } from "./digest-chip";
import { listVault } from "@/lib/api/l2";
import { addBody, addServer, EMPTY_FORM, RegistryError, type AddForm, type McpServer, type NewServer, type RegisteredServer, type Transport } from "@/lib/api/l6";
import { credentialsWaiting, formProblem, pinnedTools, toolHints, toolRisk } from "@/lib/mcp-registry";
import { useDoorOff } from "@/lib/use-doors";

/**
 * Adding a tool server, as a dialog in two steps (`POST /api/mcp`).
 *
 * Step one is the server: its name and the address it answers on. Only a
 * remote server is registered; the platform starts no server itself. Step
 * two is how it signs in, as three cards. The dialog fills the same
 * `AddForm` the inline form fills and posts `addBody(form)`: `{label, id?,
 * url, headers?, version?}`.
 *
 *   Shared credential: one header whose value is a vault reference,
 *   `${secret:name}`. The registry resolves it at each call; the console
 *   never holds the value.
 *
 *   Each person as themselves: the registry has no field for it. A
 *   registration carries one set of headers for every caller, so the card
 *   is shown and cannot be chosen.
 *
 *   Manual: header lines typed here, each value naming a vault credential
 *   (the registry refuses a plain value).
 *
 * A 201 is admission, not trust. A server with no headers was asked for its
 * tool list, its tools screened and the list pinned. A server whose headers
 * name a vault credential was sent nothing: it waits, pending with no pin,
 * until a platform admin other than the one who registered it approves its
 * address with those headers; its list is read, screened and pinned then.
 * Either way it waits, pending, until a platform admin approves the pin and
 * sets each tool's risk.
 */

type SignIn = "shared" | "personal" | "manual";

/** A vault name as the door reads a reference (`${secret:[A-Za-z0-9_-]+}`). */
const SECRET_NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** The picker's "type a name" entry; a space is in no vault name, so it can never be one. */
const OTHER = "another name";

interface Shared {
  /** The vault name picked from the list, or OTHER when it is typed. */
  picked: string;
  typed: string;
  /** HTTP: the header that carries it, and the scheme before it. */
  header: string;
  scheme: string;
  /** stdio: the environment variable the server reads it from. */
  variable: string;
}

const EMPTY_SHARED: Shared = { picked: "", typed: "", header: "Authorization", scheme: "Bearer", variable: "" };

const secretOf = (s: Shared): string => (s.picked && s.picked !== OTHER ? s.picked : s.typed.trim());

/** The one line a shared credential is, in the form's own syntax. */
function sharedLine(transport: Transport, s: Shared): string {
  const ref = `\${secret:${secretOf(s)}}`;
  if (transport === "stdio") return `${s.variable.trim()}=${ref}`;
  const scheme = s.scheme.trim();
  return `${s.header.trim()}: ${scheme ? `${scheme} ` : ""}${ref}`;
}

/** The form as it is sent: the server's fields, and the sign-in the chosen card stands for. */
function formOf(server: AddForm, mode: SignIn, shared: Shared, manual: { env: string; headers: string }): AddForm {
  if (mode === "shared") {
    const line = sharedLine(server.transport, shared);
    return { ...server, env: server.transport === "stdio" ? line : "", headers: server.transport === "http" ? line : "" };
  }
  return { ...server, env: manual.env, headers: manual.headers };
}

/** What stops step two, or "" when the form can be sent. */
function signInProblem(server: AddForm, mode: SignIn, shared: Shared, form: AddForm): string {
  if (mode === "shared") {
    const name = secretOf(shared);
    if (!name) return "Pick the secret in the vault, or name it.";
    if (!SECRET_NAME.test(name)) return "A vault name is letters, digits, - and _.";
    if (server.transport === "stdio" && !shared.variable.trim()) return "Name the environment variable the server reads the credential from.";
    if (server.transport === "http" && !shared.header.trim()) return "Name the header that carries the credential.";
  }
  return formProblem(form);
}

/** A value as the summary shows it: a reference as written, anything else never echoed. */
function valueShown(v: string): { text: string; reference: boolean } {
  if (v.includes("${secret:}")) return { text: "no secret named yet", reference: false };
  const refs = v.match(/\$\{(?:secret|env):[^}]+\}/g);
  if (!refs) return { text: "a value typed here", reference: false };
  const rest = v.replace(/\$\{(?:secret|env):[^}]+\}/g, "").trim();
  // A scheme word before a reference (`Bearer`) is not a credential; anything longer is not repeated.
  return { text: rest && /^[A-Za-z]{1,12}$/.test(rest) ? v : refs.join(" "), reference: true };
}

const pairs = (v: NewServer["env"]): [string, string][] => (v && typeof v === "object" ? Object.entries(v) : []);

/* ═══════════════════ the pieces ═══════════════════ */

function Steps({ step, canTwo, onStep }: { step: 1 | 2; canTwo: boolean; onStep: (s: 1 | 2) => void }) {
  const items: { n: 1 | 2; label: string }[] = [
    { n: 1, label: "The server" },
    { n: 2, label: "How it signs in" },
  ];
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {items.map((it, i) => {
        const on = step === it.n;
        const reachable = it.n === 1 || canTwo;
        return (
          <li key={it.n} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-5 bg-line-strong" aria-hidden />}
            <button
              type="button"
              disabled={!reachable}
              aria-current={on ? "step" : undefined}
              onClick={() => onStep(it.n)}
              className={`focusable inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-sm border px-2 text-[12px] font-medium whitespace-nowrap disabled:cursor-not-allowed ${
                on ? "border-transparent bg-ink text-on-ink" : reachable ? "border-line bg-surface text-dim hover:bg-raise hover:text-fg" : "border-line bg-raise text-ghost"
              }`}
            >
              <span className="tnum font-mono text-[10.5px]">{it.n}</span>
              {it.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Card({
  title,
  line,
  selected,
  unavailable,
  onSelect,
}: {
  title: string;
  line: string;
  selected: boolean;
  /** Why the card cannot be chosen; a card that carries one is never selectable. */
  unavailable?: string;
  onSelect?: () => void;
}) {
  const off = Boolean(unavailable);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={off || undefined}
      disabled={off}
      onClick={onSelect}
      className={`focusable flex min-w-0 flex-col gap-2 rounded-md border p-3 text-left transition-colors ${
        off ? "cursor-not-allowed border-dashed border-line-strong bg-raise/60" : selected ? "cursor-pointer border-fg bg-surface elev-1" : "cursor-pointer border-line bg-surface hover:border-line-strong hover:bg-raise/50"
      }`}
    >
      <span className="flex items-start gap-2">
        <span className={`mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full border ${off ? "border-line-strong bg-raise" : selected ? "border-ink" : "border-line-strong bg-field"}`} aria-hidden>
          {selected && !off && <span className="size-1.5 rounded-full bg-ink" />}
        </span>
        <span className={`text-[12.5px] leading-[1.35] font-semibold ${off ? "text-faint" : "text-fg"}`}>{title}</span>
      </span>
      <span className={`text-[11.5px] leading-[1.5] ${off ? "text-faint" : "text-dim"}`}>{line}</span>
      {off ? (
        <span className="mt-auto flex flex-col gap-1 border-t border-line pt-2">
          <Tag>Not available yet</Tag>
          <span className="text-[11px] leading-[1.45] text-faint">{unavailable}</span>
        </span>
      ) : (
        <span className="mt-auto pt-0.5">
          <Status tone={selected ? "ok" : "neutral"}>{selected ? "Selected" : "Available"}</Status>
        </span>
      )}
    </button>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10.5px] text-faint">{k}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] break-words text-fg">{children}</dd>
    </div>
  );
}

const unset = (text: string) => <span className="text-ghost">{text}</span>;

/** What `POST /api/mcp` will be sent, read back from the body itself. */
function Summary({ body, transport, mode, complete }: { body: NewServer; transport: Transport; mode: SignIn; complete: boolean }) {
  const carried = transport === "http" ? pairs(body.headers) : pairs(body.env);
  return (
    <dl className="flex flex-col gap-2.5">
      <Row k="Name">{body.label || unset("not named yet")}</Row>
      <Row k="Id">{body.id ? <Mono className="text-[11px] text-fg">{body.id}</Mono> : unset("derived from the name")}</Row>
      <Row k="Reached at">
        {body.url || body.command ? <Mono className="text-[11px] break-all text-fg">{body.url ?? body.command}</Mono> : unset(transport === "http" ? "no URL yet" : "no command yet")}
      </Row>
      {body.version && (
        <Row k="Version">
          <Mono className="text-[11px] text-fg">{body.version}</Mono>
        </Row>
      )}
      {transport === "stdio" && (
        <Row k="Container">
          {body.isolate ? (
            <span>
              {body.isolate.image ? <Mono className="text-[11px] break-all text-fg">{body.isolate.image}</Mono> : "the deployment’s image"}, {body.isolate.network ? `network ${body.isolate.network}` : "no network"}
            </span>
          ) : (
            unset("none asked for")
          )}
        </Row>
      )}
      <Row k="Signs in">
        {!complete ? unset("chosen in step 2") : mode === "shared" ? "Shared credential, from the vault" : carried.length ? "Manual" : "Manual, nothing sent"}
      </Row>
      {complete && (
        <Row k={transport === "http" ? "Headers sent" : "Environment handed over"}>
          {carried.length === 0 && unset("none")}
          {carried.map(([name, value]) => {
            const v = valueShown(value);
            return (
              <span key={name} className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
                <Mono className="rounded-[3px] bg-raise px-1 py-px text-[10.5px] text-fg">{name}</Mono>
                {v.reference ? <Mono className="text-[10.5px] break-all text-dim">{v.text}</Mono> : <span className="text-[11px] text-faint">{v.text}</span>}
              </span>
            );
          })}
        </Row>
      )}
    </dl>
  );
}

/* ═══════════════════ the dialog ═══════════════════ */

export function AddServerDialog({
  twoPerson,
  onClose,
  onAdded,
  onRefused,
  renderRefusal,
}: {
  /** Approval needs a second person on this deployment. */
  twoPerson: boolean;
  onClose: () => void;
  /** Admitted: 201, pending. The list is read again and shows the row. */
  onAdded: (s: McpServer) => void;
  /** The screener refused admission; the registry stored the server as `refused`, so the list has changed. */
  onRefused?: () => void;
  /** A refusal as the list draws one (the message, the control, the screener's hits). */
  renderRefusal: (error: RegistryError | Error) => ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [server, setServer] = useState<AddForm>(EMPTY_FORM);
  const [mode, setMode] = useState<SignIn>("shared");
  const [shared, setShared] = useState<Shared>(EMPTY_SHARED);
  const [manual, setManual] = useState({ env: "", headers: "" });
  const [vault, setVault] = useState<{ name: string; label: string }[] | null>(null);
  const [vaultError, setVaultError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RegistryError | Error | null>(null);
  const [done, setDone] = useState<RegisteredServer | null>(null);

  useEffect(() => {
    let live = true;
    listVault()
      .then((v) => {
        if (live) setVault(v.keys.filter((k) => k.set !== false).map((k) => ({ name: k.name, label: k.label ?? "" })));
      })
      .catch((e: Error) => {
        if (!live) return;
        setVault([]);
        setVaultError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);

  const stdio = false;
  const addDoor = useDoorOff("POST", "/api/mcp");
  const form = useMemo(() => formOf(server, mode, shared, manual), [server, mode, shared, manual]);
  const body = useMemo(() => addBody(form), [form]);
  // Step one answers for the server alone: the sign-in is checked on its own step.
  const serverProblem = formProblem({ ...server, env: "", headers: "" });
  const problem = serverProblem || signInProblem(server, mode, shared, form);
  const dirty = Boolean(server.label || server.id || server.command || server.url || server.version || server.image || server.network || manual.env || manual.headers || shared.typed || shared.picked);

  const patch = (p: Partial<AddForm>) => {
    setServer((f) => ({ ...f, ...p }));
    setError(null);
  };
  const patchShared = (p: Partial<Shared>) => {
    setShared((s) => ({ ...s, ...p }));
    setError(null);
  };

  // Escape closes; Tab stays inside; focus returns to where it was.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input")?.focus();
    return () => before?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        // An open picker's list takes Escape first, and says so.
        if (e.defaultPrevented) return;
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const f = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const submit = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const added = await addServer(body);
      setDone(added);
      onAdded(added);
    } catch (e) {
      const err = e as RegistryError | Error;
      if (err instanceof RegistryError && err.status === 502) setError(new RegistryError(`The server could not be discovered: ${err.message}`, 502));
      else setError(err);
      // A screener refusal is stored as `refused`; the list shows it at once.
      if (err instanceof RegistryError && err.status === 422) onRefused?.();
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    setDone(null);
    setStep(1);
    setServer(EMPTY_FORM);
    setMode("shared");
    setShared(EMPTY_SHARED);
    setManual({ env: "", headers: "" });
    setError(null);
  };

  const secretName = secretOf(shared);
  const known = vault?.some((k) => k.name === secretName) ?? false;
  const typing = !vault?.length || shared.picked === OTHER;
  const refused = error instanceof RegistryError && error.status === 422;
  const doneTools = done ? pinnedTools(done) : [];
  /** The server added names vault credentials: nothing was sent to it, and its list waits for a second person. */
  const doneWaiting = done ? credentialsWaiting(done) : false;
  /** What is about to be sent names the vault: nothing is sent to the server on adding. */
  const sendsCredentials = Boolean(body.headers && Object.keys(body.headers).length);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/75 p-3 sm:p-6"
      onPointerDown={(e) => {
        // A click on the scrim closes an untouched dialog; one with typing in it asks for Cancel.
        if (e.target === e.currentTarget && !busy && (!dirty || done)) onClose();
      }}
    >
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[92vh] w-[min(980px,100%)] flex-col overflow-hidden rounded-lg border border-line bg-surface elev-3 af-pop">
        <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
          <span className="flex min-w-0 grow flex-col">
            <span id={titleId} className="text-[14px] font-semibold tracking-[-0.005em]">
              {done ? `${done.label} added` : "Add a tool server"}
            </span>
            <span className="max-w-[80ch] text-[11.5px] leading-[1.5] text-faint">
              {done
                ? doneWaiting
                  ? "Registered. Nothing has been sent to it, and it is not in use."
                  : "Admitted and pinned. It is not in use yet."
                : "A remote MCP server whose tools agents may be given. Adding it is admission, not trust: nothing attaches to a run until a platform admin approves its tool list and sets each tool's risk."}
            </span>
          </span>
          {!done && <Steps step={step} canTwo={!serverProblem} onStep={setStep} />}
        </header>

        {done ? (
          <div className="flex min-h-0 grow flex-col gap-4 overflow-y-auto p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Status tone="warn">Pending approval</Status>
              <span className="text-[12.5px] font-medium text-fg">{done.label}</span>
              <Mono className="text-[10.5px] text-faint">{done.id}</Mono>
              <Tag>{done.transport === "http" ? "HTTP" : "stdio"}</Tag>
            </div>
            {doneWaiting && (
              <div className="flex flex-col gap-2">
                <span className="text-[12.5px] font-semibold text-fg">What happens next</span>
                <ol className="flex flex-col gap-2 text-[12.5px] leading-[1.55] text-dim">
                  <li className="flex gap-2.5">
                    <Status tone="warn">Waiting</Status>
                    <span className="min-w-0">
                      Its headers name the vault credential{done.credentials.length === 1 ? "" : "s"} {done.credentials.join(", ") || "given"}. Nothing has been sent to the server and its tool list has not been read: a platform admin other than you must first approve sending {done.credentials.length === 1 ? "that credential" : "those credentials"} to {done.url ?? "its address"}.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <Status tone="neutral">Then</Status>
                    <span className="min-w-0">On that approval the server is asked for its tool list with the credentials; every tool&rsquo;s name, description and input schema goes through the screener, and the list is pinned by digest. A screener hit keeps the server as refused.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <Status tone="neutral">Last</Status>
                    <span className="min-w-0">
                      A platform admin approves the pin and sets each tool&rsquo;s risk before any agent can use it; a tool left unset counts as destructive.{twoPerson ? " Two-person approval is on, so that admin cannot be you." : ""}
                    </span>
                  </li>
                </ol>
              </div>
            )}
            {!doneWaiting && (
            <div className="flex flex-col gap-2">
              <span className="text-[12.5px] font-semibold text-fg">What happens next</span>
              <ol className="flex flex-col gap-2 text-[12.5px] leading-[1.55] text-dim">
                <li className="flex gap-2.5">
                  <Status tone="ok">Screened</Status>
                  <span className="min-w-0">The server was asked for its tool list, and every tool&rsquo;s name, description and input schema went through the screener. It raised nothing.</span>
                </li>
                <li className="flex gap-2.5">
                  <Status tone="ok">Pinned</Status>
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    Its tool list, {doneTools.length} tool{doneTools.length === 1 ? "" : "s"}, is pinned by digest
                    {done.pin && <DigestChip digest={done.pin.digest} label="Pin" />}
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <Status tone="warn">Waiting</Status>
                  <span className="min-w-0">
                    A platform admin must approve the pin and set each tool&rsquo;s risk before any agent can use it; a tool left unset counts as destructive. Until then nothing attaches to a run.
                    {twoPerson ? " Two-person approval is on, so that admin cannot be you." : ""}
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <Status tone="neutral">Later</Status>
                  <span className="min-w-0">A rescan that finds a different tool list detaches the server until someone approves the new list.</span>
                </li>
              </ol>
            </div>
            )}
            {doneTools.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-[10.5px] text-faint">Pinned tools</span>
                {doneTools.map((t) => {
                  const h = toolHints(t);
                  const r = toolRisk(t);
                  return (
                    <span key={t.name} title={`${t.description || t.name}\nThe server's hints say ${h.risk}; the risk is set when the pin is approved.`} className="inline-flex items-center gap-1 rounded-[3px] border border-line bg-surface px-1 py-px font-mono text-[10px] text-dim">
                      {t.name}
                      <span className="text-err">· {r.risk}{r.set ? "" : " until set"}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="grid min-h-0 grow overflow-y-auto md:grid-cols-[minmax(0,1fr)_280px] md:overflow-hidden">
            <form
              className="flex min-w-0 flex-col gap-4 p-4 md:overflow-y-auto"
              onSubmit={(e) => {
                e.preventDefault();
                if (step === 1) {
                  if (!serverProblem) setStep(2);
                } else void submit();
              }}
            >
              {step === 1 ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Name">
                      <Input value={server.label} onChange={(v) => patch({ label: v })} autoComplete="off" />
                    </Field>
                    <Field label="Id (optional)" hint="Derived from the name when blank.">
                      <Input value={server.id} onChange={(v) => patch({ id: v })} mono autoComplete="off" />
                    </Field>
                  </div>
                  <Field label="Address it answers on" hint="An https address; http only at a loopback address. It carries no credentials and no query: those go in a header in step 2.">
                    <Input value={server.url} onChange={(v) => patch({ url: v })} mono type="url" autoComplete="off" />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Version (optional)" hint="The version you expect; kept on the row.">
                      <Input value={server.version} onChange={(v) => patch({ version: v })} mono autoComplete="off" />
                    </Field>
                  </div>
                </>
              ) : (
                <>
                  <div role="radiogroup" aria-label="How it signs in" className="grid gap-2.5 sm:grid-cols-3">
                    <Card
                      title="Shared credential"
                      line="Every caller uses one credential the platform holds in the vault."
                      selected={mode === "shared"}
                      onSelect={() => {
                        setMode("shared");
                        setError(null);
                      }}
                    />
                    <Card
                      title="Each person as themselves"
                      line="Each caller signs in to the server under their own identity."
                      selected={false}
                      unavailable="The control plane cannot do this yet: a registration carries one sign-in for every caller."
                    />
                    <Card
                      title="Manual"
                      line="Header lines you type here, each naming a vault credential, or none at all."
                      selected={mode === "manual"}
                      onSelect={() => {
                        setMode("manual");
                        setError(null);
                      }}
                    />
                  </div>

                  {mode === "shared" && (
                    <div className="flex flex-col gap-4">
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-[12.5px] font-medium text-mist">Secret in the vault</span>
                          {vault === null ? (
                            <Pick value="" onChange={() => {}} options={[]} size="md" loading aria-label="Secret in the vault" />
                          ) : vault.length > 0 ? (
                            <Pick
                              value={shared.picked}
                              onChange={(v) => patchShared({ picked: v })}
                              size="md"
                              aria-label="Secret in the vault"
                              options={[
                                ...(shared.picked ? [] : [{ value: "", label: "Pick a secret" }]),
                                ...vault.map((k) => ({ value: k.name, label: k.label ? `${k.name} · ${k.label}` : k.name })),
                                { value: OTHER, label: "Another name…" },
                              ]}
                            />
                          ) : null}
                          {vault !== null && typing && <Input value={shared.typed} onChange={(v) => patchShared({ typed: v })} mono autoComplete="off" aria-label="Vault name of the secret" />}
                          <span className="text-[11.5px] leading-[1.5] text-faint">
                            {vaultError
                              ? `The vault could not be read (${vaultError}). Name the secret; the registry checks it.`
                              : vault !== null && vault.length === 0 && !vaultError
                                ? "The vault holds no secret yet. Name the one you will store; the registry refuses a reference nothing holds."
                                : "Referenced by name; the value never leaves the vault."}{" "}
                            Secrets are stored under{" "}
                            <a href="/configuration#credentials" target="_blank" rel="noreferrer" className="focusable underline decoration-line-strong underline-offset-2 hover:decoration-fg">
                              Configuration, Credentials
                            </a>
                            .
                          </span>
                        </div>
                        {stdio ? (
                          <Field label="Environment variable" hint="The variable the server reads the credential from.">
                            <Input value={shared.variable} onChange={(v) => patchShared({ variable: v })} mono autoComplete="off" />
                          </Field>
                        ) : (
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Header">
                              <Input value={shared.header} onChange={(v) => patchShared({ header: v })} mono autoComplete="off" />
                            </Field>
                            <Field label="Scheme" hint="Blank sends the secret alone.">
                              <Input value={shared.scheme} onChange={(v) => patchShared({ scheme: v })} mono autoComplete="off" />
                            </Field>
                          </div>
                        )}
                      </div>
                      {secretName && vault !== null && vault.length > 0 && !vaultError && typing && SECRET_NAME.test(secretName) && !known && (
                        <p className="text-[11.5px] leading-[1.5] text-warn">The vault does not list &ldquo;{secretName}&rdquo;. The registry refuses a reference nothing holds: store the secret first, then add the server.</p>
                      )}
                      <div className="flex flex-col gap-1 rounded-md border border-line bg-canvas px-3 py-2">
                        <span className="text-[10.5px] text-faint">{stdio ? "Environment handed to the server" : "Header sent with every call"}</span>
                        <Mono className="text-[11px] break-all text-fg">{secretName ? sharedLine(server.transport, shared) : stdio ? "set once a secret and a variable are named" : "set once a secret is named"}</Mono>
                      </div>
                      <p className="text-[11.5px] leading-[1.5] text-faint">
                        One {stdio ? "variable" : "header"} carries the credential. A server that wants more than one, or none, is added as Manual; a line there can still reference the vault as{" "}
                        <Mono className="text-[10.5px]">{"${secret:name}"}</Mono>.
                      </p>
                    </div>
                  )}

                  {mode === "manual" && (
                    <div className="flex flex-col gap-2">
                      <Field
                        label="Headers, one Name: value per line (optional)"
                        hint="Each value names a vault credential as ${secret:name}, with any text around it. Leave it blank for a server that needs no sign-in."
                      >
                        {stdio ? (
                          <Textarea rows={4} value={manual.env} onChange={(v) => { setManual((m) => ({ ...m, env: v })); setError(null); }} mono />
                        ) : (
                          <Textarea rows={4} value={manual.headers} onChange={(v) => { setManual((m) => ({ ...m, headers: v })); setError(null); }} mono />
                        )}
                      </Field>
                      <p className="text-[11.5px] leading-[1.5] text-faint">
                        The registry keeps the references, never a credential, and refuses a plain value. Only the header names are shown again.
                      </p>
                    </div>
                  )}

                  {error && (
                    <div className={`flex flex-col gap-1.5 rounded-md border bg-surface px-3 py-2.5 border-err-line`}>
                      {renderRefusal(error)}
                      {refused && <span className="text-[11.5px] leading-[1.5] text-dim">The registry kept the server as refused; it is in the list with these hits, and it never attaches to a run.</span>}
                    </div>
                  )}
                </>
              )}
              {/* Enter in a field moves on, as the buttons below do. */}
              <button type="submit" hidden aria-hidden tabIndex={-1} />
            </form>

            <aside className="flex min-w-0 flex-col gap-4 border-t border-line bg-canvas p-4 md:overflow-y-auto md:border-t-0 md:border-l">
              <div className="flex flex-col gap-2.5">
                <span className="text-[12px] font-semibold text-fg">What will be registered</span>
                <Summary body={body} transport={server.transport} mode={mode} complete={step === 2} />
              </div>
              <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                <span className="text-[12px] font-semibold text-fg">On adding</span>
                {sendsCredentials ? (
                  <p className="text-[11.5px] leading-[1.55] text-dim">
                    Its headers name a vault credential, so nothing is sent to the server on adding. It waits, pending, until a platform admin other than you approves sending the credential to this address; its tool list is then read with it, screened and pinned. A platform admin must then approve the pin and set each tool&rsquo;s risk before any agent can use it.
                  </p>
                ) : (
                  <p className="text-[11.5px] leading-[1.55] text-dim">
                    The server is asked for its tool list. Each tool is screened and the list is pinned by digest. The server then waits, pending: a platform admin must approve the pin and set each tool&rsquo;s risk before any agent can use it
                    {twoPerson ? ", and with two-person approval on that cannot be you" : ""}.
                  </p>
                )}
              </div>
            </aside>
          </div>
        )}

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          {done ? (
            <>
              <span className="grow" />
              <Button size="sm" variant="solid" tone="neutral" permission="configure" onClick={again}>
                Add another
              </Button>
              <Button size="sm" variant="solid" tone="ink" onClick={onClose}>
                Show it in the list
              </Button>
            </>
          ) : (
            <>
              <span className="min-w-0 grow text-[11.5px] leading-[1.5] text-faint">
                {step === 1 ? (dirty ? serverProblem : "") : addDoor.off ? addDoor.why : problem && !error ? problem : busy ? (sendsCredentials ? "Registering it. Nothing is sent to the server." : "Asking it for its tool list. A slow server may take up to 30 seconds.") : ""}
              </span>
              <Button size="sm" variant="solid" tone="err" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              {step === 2 && (
                <Button size="sm" variant="solid" tone="neutral" onClick={() => setStep(1)} disabled={busy}>
                  Back
                </Button>
              )}
              {step === 1 ? (
                <Button size="sm" variant="solid" tone="ink" disabled={Boolean(serverProblem)} onClick={() => setStep(2)}>
                  Next: how it signs in
                </Button>
              ) : (
                <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={Boolean(problem) || addDoor.off} title={addDoor.why} loading={busy} onClick={() => void submit()}>
                  {busy ? "Adding…" : "Add server"}
                </Button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
