"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { Field, Input, Textarea } from "./forms";
import { NotConnectedNote } from "./pending";
import { ACTS_AS, PURPOSES, REGISTRATIONS, ServerState, UPSTREAM_NOT_BUILT, hasS256, subjectKind } from "./authorization-parts";
import {
  ask,
  refusalField,
  type Answer,
  type AuthServer,
  type AuthServerActsAs,
  type AuthServerAdd,
  type AuthServerAdded,
  type AuthServerMetadata,
  type AuthServerPurpose,
  type AuthServerRegistration,
  type Door,
} from "@/lib/api/pending";

/**
 * Adding an authorization server, as a dialog in two steps. It follows the
 * dialog that adds a tool server (components/add-server-dialog.tsx): the
 * same frame, the same steps in the header, the same summary at the side.
 *
 * Step one is the issuer: its address, and the metadata it publishes. The
 * platform reads that metadata (door `authServerProbe`); the dialog lists
 * what will be read, and shows values only once the door has answered with
 * them. Step two is what the issuer is trusted for: a per-person token for a
 * tool (with how this deployment is registered and whom it acts as), or the
 * tokens a workload exchanges for a short session (with the subjects
 * admitted).
 *
 * What is sent is `AuthServerAdd` to door `authServerAdd` (lib/api/pending.ts).
 */

/** A vault name as a reference reads it (`${secret:[A-Za-z0-9_-]+}`). */
const SECRET_NAME = /^[A-Za-z0-9_-]{1,64}$/;

interface Form {
  issuer: string;
  name: string;
  purpose: AuthServerPurpose;
  registration: AuthServerRegistration;
  actsAs: AuthServerActsAs;
  clientId: string;
  secret: string;
  subjects: string;
}
// Upstream trust is not built (UPSTREAM_NOT_BUILT), so a new issuer is added for workloads.
const EMPTY: Form = { issuer: "", name: "", purpose: "workload", registration: "dynamic", actsAs: "person", clientId: "", secret: "", subjects: "" };

function issuerUrl(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

/** What stops step one, or "" when the address can be an issuer's. */
function issuerProblem(raw: string): string {
  const v = raw.trim();
  if (!v) return "Enter the issuer's address.";
  const u = issuerUrl(v);
  if (!u || u.protocol !== "https:") return "An issuer's address starts with https://.";
  if (u.username || u.password) return "An issuer's address carries no credentials.";
  if (u.search || u.hash) return "An issuer's address has no query and no fragment.";
  return "";
}

const subjectsOf = (text: string): string[] => [...new Set(text.split(/\n/).map((s) => s.trim()).filter(Boolean))];

/** What stops step two, or "" when the form can be sent. */
function trustProblem(f: Form): string {
  if (f.purpose === "upstream") {
    if (f.registration === "manual") {
      if (!f.clientId.trim()) return "Enter the client id the issuer gave this deployment.";
      if (f.secret.trim() && !SECRET_NAME.test(f.secret.trim())) return "A vault name is letters, digits, - and _.";
    }
    return "";
  }
  const subjects = subjectsOf(f.subjects);
  if (!subjects.length) return "Name at least one subject to admit.";
  for (const s of subjects) {
    if (/\s/.test(s)) return `"${s}" has a space in it; a subject is one word.`;
    if (s === "*") return "A lone * would admit every workload from this issuer. Name a prefix before it.";
    if (s.slice(0, -1).includes("*")) return `"${s}": a * may only end a subject, as a prefix.`;
  }
  return "";
}

function bodyOf(f: Form): AuthServerAdd {
  const base: AuthServerAdd = { issuer: f.issuer.trim(), purpose: f.purpose };
  if (f.name.trim()) base.name = f.name.trim();
  if (f.purpose === "workload") return { ...base, subjects: subjectsOf(f.subjects) };
  const out: AuthServerAdd = { ...base, registration: f.registration, acts_as: f.actsAs };
  if (f.registration === "manual") {
    out.client_id = f.clientId.trim();
    if (f.secret.trim()) out.client_secret = `\${secret:${f.secret.trim()}}`;
  }
  return out;
}

/* ═══════════════════ the pieces ═══════════════════ */

function Steps({ step, canTwo, onStep }: { step: 1 | 2; canTwo: boolean; onStep: (s: 1 | 2) => void }) {
  const items: { n: 1 | 2; label: string }[] = [
    { n: 1, label: "The issuer" },
    { n: 2, label: "What it is trusted for" },
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

function Choice({ title, line, selected, unavailable, unavailableTag = "Not offered by this issuer", onSelect }: { title: string; line: string; selected: boolean; /** Why it cannot be chosen. */ unavailable?: string; /** The tag over that reason. */ unavailableTag?: string; onSelect: () => void }) {
  const off = Boolean(unavailable);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected && !off}
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
          <Tag>{unavailableTag}</Tag>
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

function Segments<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <span role="radiogroup" aria-label={label} className="inline-flex h-9 max-w-full items-center gap-px self-start overflow-x-auto rounded-md border border-line bg-raise p-px">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`focusable h-full cursor-pointer rounded-sm px-3 text-[12.5px] whitespace-nowrap transition-colors ${value === o.id ? "bg-surface font-medium text-fg shadow-[var(--shadow-1)]" : "text-faint hover:text-dim"}`}
        >
          {o.label}
        </button>
      ))}
    </span>
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

/** What the issuer publishes: the names of what is read, and the values once the door has answered with them. */
function Published({ meta }: { meta: AuthServerMetadata | null }) {
  const value = (v: string | undefined) => (meta ? v ? <Mono className="text-[11px] break-all text-fg">{v}</Mono> : unset("not published") : unset("not read yet"));
  const methods = meta?.code_challenge_methods_supported;
  return (
    <dl className="grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
      <Row k="Where sign-in starts (authorization endpoint)">{value(meta?.authorization_endpoint)}</Row>
      <Row k="Where tokens are issued (token endpoint)">{value(meta?.token_endpoint)}</Row>
      <Row k="Where a client registers itself (registration endpoint)">{value(meta?.registration_endpoint)}</Row>
      <Row k="Where its signing keys are (keys address)">{value(meta?.jwks_uri)}</Row>
      <Row k="PKCE methods it advertises">
        {meta ? methods?.length ? methods.map((m) => <Tag key={m} tone={m === "S256" ? "ok" : "neutral"}>{m}</Tag>) : unset("none published") : unset("not read yet")}
      </Row>
      {meta?.metadata_url && (
        <Row k="Read from">
          <Mono className="text-[11px] break-all text-fg">{meta.metadata_url}</Mono>
        </Row>
      )}
    </dl>
  );
}

/* ═══════════════════ the dialog ═══════════════════ */

export function AddAuthServerDialog({ onClose, onAdded }: { onClose: () => void; /** Added: the list is read again and shows the row. */ onAdded: (s: AuthServer | null) => void }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<Form>(EMPTY);
  // What was read belongs to the address it was read from: an answer is kept with that address and shown only while the field still holds it.
  const [probed, setProbed] = useState<{ issuer: string; answer: Answer<AuthServerMetadata> } | null>(null);
  const [probing, setProbing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ door: Door } | { message: string } | null>(null);
  const [done, setDone] = useState<{ server: AuthServer | null; name: string } | null>(null);

  const patch = (p: Partial<Form>) => {
    setForm((f) => ({ ...f, ...p }));
    setFailed(null);
  };

  const atIssuer = issuerProblem(form.issuer);
  const atTrust = trustProblem(form);
  const problem = atIssuer || atTrust;
  const host = issuerUrl(form.issuer)?.host ?? "";
  const dirty = Boolean(form.issuer || form.name || form.clientId || form.secret || form.subjects);
  const probe = probed && probed.issuer === form.issuer.trim() ? probed.answer : null;
  const meta = probe?.state === "ok" && probe.data && typeof probe.data === "object" ? probe.data : null;
  const noS256 = Boolean(meta) && !hasS256(meta?.code_challenge_methods_supported);
  const body = bodyOf(form);
  const upstream = form.purpose === "upstream";

  /* What the metadata rules out, once it has been read. Before that every method can be chosen and the door decides. */
  const noDynamic = meta && !meta.registration_endpoint ? "It publishes no address where a client can register itself." : undefined;
  const noHosted = meta && meta.client_id_metadata_document_supported === false ? "It says it does not accept a client known by a hosted metadata document." : undefined;
  const methodOff = (form.registration === "dynamic" && noDynamic) || (form.registration === "metadata" && noHosted) || "";

  // Escape closes; Tab stays inside; focus returns to where it was.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input")?.focus();
    return () => before?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
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

  const read = async () => {
    if (atIssuer || probing) return;
    setProbing(true);
    const asked = form.issuer.trim();
    const a = await ask<AuthServerMetadata>("authServerProbe", { body: { issuer: asked } });
    setProbing(false);
    setProbed({ issuer: asked, answer: a });
  };

  const submit = async () => {
    if (problem || methodOff || busy) return;
    setBusy(true);
    setFailed(null);
    const a = await ask<AuthServerAdded>("authServerAdd", { body });
    setBusy(false);
    if (a.state === "pending") return setFailed({ door: a.door });
    if (a.state === "error") return setFailed({ message: refusalField(a, "not_built") ? `not built: ${a.message}` : a.message });
    const got = a.data && typeof a.data === "object" ? ("server" in a.data ? a.data.server : a.data) : null;
    const server = got && typeof (got as AuthServer).id === "string" ? (got as AuthServer) : null;
    setDone({ server, name: server?.name || form.name.trim() || host });
    onAdded(server);
  };

  const again = () => {
    setDone(null);
    setStep(1);
    setForm(EMPTY);
    setProbed(null);
    setFailed(null);
  };

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
              {done ? `${done.name} added` : "Add an authorization server"}
            </span>
            <span className="max-w-[80ch] text-[11.5px] leading-[1.5] text-faint">
              {done ? "This deployment now trusts it for what was chosen." : "An outside issuer this deployment will trust for workloads: a service signs in with a token it signed. Upstream trust, a per-person token for a tool, is not built."}
            </span>
          </span>
          {!done && <Steps step={step} canTwo={!atIssuer} onStep={setStep} />}
        </header>

        {done ? (
          <div className="flex min-h-0 grow flex-col gap-4 overflow-y-auto p-4">
            <div className="flex flex-wrap items-center gap-2">
              {done.server ? <ServerState state={done.server.state} /> : <Status tone="ok">Added</Status>}
              <span className="text-[12.5px] font-medium text-fg">{done.name}</span>
              {done.server && <Mono className="text-[10.5px] text-faint">{done.server.id}</Mono>}
              <Tag>{PURPOSES[done.server?.purpose ?? form.purpose].label}</Tag>
            </div>
            <dl className="grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
              <Row k="Issuer address">
                <Mono className="text-[11px] break-all text-fg">{done.server?.issuer ?? body.issuer}</Mono>
              </Row>
              {(done.server?.purpose ?? form.purpose) === "upstream" ? (
                <>
                  <Row k="Registered by">{REGISTRATIONS[done.server?.registration ?? form.registration]?.label ?? done.server?.registration}</Row>
                  <Row k="Acts as">{ACTS_AS[done.server?.acts_as ?? form.actsAs]?.label ?? done.server?.acts_as}</Row>
                  {done.server?.client_id && (
                    <Row k="Client id held with the issuer">
                      <Mono className="text-[11px] break-all text-fg">{done.server.client_id}</Mono>
                    </Row>
                  )}
                </>
              ) : (
                <Row k="Admitted subjects">
                  {(done.server?.subjects ?? body.subjects ?? []).map((s) => (
                    <Mono key={s} className="rounded-[3px] bg-raise px-1 py-px text-[10.5px] text-fg">
                      {s}
                    </Mono>
                  ))}
                </Row>
              )}
            </dl>
            <p className="max-w-[80ch] text-[12.5px] leading-[1.55] text-dim">
              It is in the list under {(done.server?.purpose ?? form.purpose) === "upstream" ? "Upstream services" : "Workloads"}, with the state the control plane found it in.
            </p>
          </div>
        ) : (
          <div className="grid min-h-0 grow overflow-y-auto md:grid-cols-[minmax(0,1fr)_280px] md:overflow-hidden">
            <form
              className="flex min-w-0 flex-col gap-4 p-4 md:overflow-y-auto"
              onSubmit={(e) => {
                e.preventDefault();
                if (step === 1) {
                  if (!atIssuer) setStep(2);
                } else void submit();
              }}
            >
              {step === 1 ? (
                <>
                  <Field label="Issuer address" hint="Starting https://, as the issuer names itself. The platform reads what it publishes from there.">
                    <Input value={form.issuer} onChange={(v) => patch({ issuer: v })} mono type="url" autoComplete="off" />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Name (optional)" hint="Taken from the address when blank.">
                      <Input value={form.name} onChange={(v) => patch({ name: v })} autoComplete="off" />
                    </Field>
                  </div>

                  <div className="flex flex-col gap-3 rounded-md border border-line bg-canvas p-3">
                    <span className="flex flex-wrap items-start gap-x-3 gap-y-2">
                      <span className="flex min-w-0 grow basis-[260px] flex-col gap-0.5">
                        <span className="text-[12.5px] font-medium text-mist">What the platform reads from the issuer</span>
                        <span className="text-[11.5px] leading-[1.5] text-faint">
                          The metadata document the issuer publishes at its well-known address (<Mono className="text-[10.5px]">/.well-known/oauth-authorization-server</Mono>, or{" "}
                          <Mono className="text-[10.5px]">/.well-known/openid-configuration</Mono>). Nothing is typed in by hand, and nothing is stored until the server is added.
                        </span>
                      </span>
                      <Button size="sm" variant="solid" tone="neutral" permission="iam" disabled={Boolean(atIssuer)} loading={probing} onClick={() => void read()}>
                        {meta ? "Read it again" : "Read it now"}
                      </Button>
                    </span>
                    <Published meta={meta} />
                    {probe?.state === "pending" && <NotConnectedNote door={probe.door} />}
                    {probe?.state === "error" && (<span className="text-[11.5px] leading-[1.5] text-err">The metadata could not be read: {probe.message}</span>)}
                    {noS256 && (
                      <span className="text-[11.5px] leading-[1.5] text-warn">
                        This issuer does not advertise PKCE with S256, the check that stops a stolen sign-in code from being used. A sign-in through it for an upstream service is weaker for that.
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[12.5px] font-medium text-mist">What it is trusted for</span>
                    <div role="radiogroup" aria-label="What it is trusted for" className="grid gap-2.5 sm:grid-cols-2">
                      <Choice title={PURPOSES.workload.label} line={PURPOSES.workload.line} selected={form.purpose === "workload"} onSelect={() => patch({ purpose: "workload" })} />
                      <Choice title={PURPOSES.upstream.label} line={PURPOSES.upstream.line} selected={false} unavailable={UPSTREAM_NOT_BUILT} unavailableTag="Not built" onSelect={() => undefined} />
                    </div>
                  </div>

                  {upstream ? (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[12.5px] font-medium text-mist">How this deployment is registered with it</span>
                        <div role="radiogroup" aria-label="How this deployment is registered with it" className="grid gap-2.5 sm:grid-cols-3">
                          <Choice title={REGISTRATIONS.dynamic.label} line={REGISTRATIONS.dynamic.line} selected={form.registration === "dynamic"} unavailable={noDynamic} onSelect={() => patch({ registration: "dynamic" })} />
                          <Choice title={REGISTRATIONS.metadata.label} line={REGISTRATIONS.metadata.line} selected={form.registration === "metadata"} unavailable={noHosted} onSelect={() => patch({ registration: "metadata" })} />
                          <Choice title={REGISTRATIONS.manual.label} line={REGISTRATIONS.manual.line} selected={form.registration === "manual"} onSelect={() => patch({ registration: "manual" })} />
                        </div>
                        {!meta && <span className="text-[11.5px] leading-[1.5] text-faint">Which of these the issuer offers is known once its metadata has been read; the control plane refuses one it does not offer.</span>}
                      </div>
                      {form.registration === "manual" && (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field label="Client id" hint="As the issuer gave it when this deployment was registered there.">
                            <Input value={form.clientId} onChange={(v) => patch({ clientId: v })} mono autoComplete="off" />
                          </Field>
                          <Field label="Vault name of the client secret (optional)" hint="Referenced by name; the value never leaves the vault. Blank for a client with no secret.">
                            <Input value={form.secret} onChange={(v) => patch({ secret: v })} mono autoComplete="off" />
                          </Field>
                        </div>
                      )}
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[12.5px] font-medium text-mist">Whom a tool is called as</span>
                        <Segments label="Whom a tool is called as" value={form.actsAs} onChange={(v) => patch({ actsAs: v })} options={(Object.keys(ACTS_AS) as AuthServerActsAs[]).map((a) => ({ id: a, label: ACTS_AS[a].label }))} />
                        <span className="max-w-[72ch] text-[11.5px] leading-[1.5] text-faint">{ACTS_AS[form.actsAs].line}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Field label="Admitted subjects, one per line" hint="Each is exact, or a prefix ending in *. A token whose subject matches none of them is refused.">
                        <Textarea rows={4} value={form.subjects} onChange={(v) => patch({ subjects: v })} mono />
                      </Field>
                      {subjectsOf(form.subjects).length > 0 && (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {subjectsOf(form.subjects).map((s) => (
                            <span key={s} className="inline-flex items-center gap-1.5 rounded-[3px] border border-line bg-surface px-1.5 py-px">
                              <Mono className="text-[10.5px] break-all text-fg">{s}</Mono>
                              <span className="text-[10px] text-faint">{subjectKind(s)}</span>
                            </span>
                          ))}
                        </span>
                      )}
                      <p className="max-w-[72ch] text-[11.5px] leading-[1.5] text-faint">
                        Nothing is registered with a workload issuer: a token from it is checked against the keys it publishes. A service admitted from it acts with its own authority: it may read and start runs, and never approve, configure or change identity.
                      </p>
                    </div>
                  )}

                  {failed && (
                    <div className={`flex flex-col gap-1.5 rounded-md border bg-surface px-3 py-2.5 ${"door" in failed ? "border-dashed border-line-strong" : "border-err-line"}`}>
                      {"door" in failed ? <NotConnectedNote door={failed.door} /> : <span className="text-[12px] leading-[1.5] text-err">It was not added: {failed.message}</span>}
                    </div>
                  )}
                </>
              )}
              {/* Enter in a field moves on, as the buttons below do. */}
              <button type="submit" hidden aria-hidden tabIndex={-1} />
            </form>

            <aside className="flex min-w-0 flex-col gap-4 border-t border-line bg-canvas p-4 md:overflow-y-auto md:border-t-0 md:border-l">
              <div className="flex flex-col gap-2.5">
                <span className="text-[12px] font-semibold text-fg">What will be added</span>
                <dl className="flex flex-col gap-2.5">
                  <Row k="Issuer address">{body.issuer ? <Mono className="text-[11px] break-all text-fg">{body.issuer}</Mono> : unset("no address yet")}</Row>
                  <Row k="Name">{body.name || (host ? <span>{host} <span className="text-faint">(from the address)</span></span> : unset("taken from the address"))}</Row>
                  <Row k="Trusted for">{step === 2 ? PURPOSES[form.purpose].label : unset("chosen in step 2")}</Row>
                  {step === 2 && upstream && (
                    <>
                      <Row k="Registered by">{REGISTRATIONS[form.registration].label}</Row>
                      {form.registration === "manual" && (
                        <Row k="Client">
                          {body.client_id ? <Mono className="text-[11px] break-all text-fg">{body.client_id}</Mono> : unset("no client id yet")}
                          {body.client_secret && <Mono className="text-[10.5px] break-all text-dim">{body.client_secret}</Mono>}
                        </Row>
                      )}
                      <Row k="Acts as">{ACTS_AS[form.actsAs].label}</Row>
                    </>
                  )}
                  {step === 2 && !upstream && (
                    <Row k="Admitted subjects">
                      {body.subjects?.length
                        ? body.subjects.map((s) => (
                            <Mono key={s} className="rounded-[3px] bg-raise px-1 py-px text-[10.5px] break-all text-fg">
                              {s}
                            </Mono>
                          ))
                        : unset("none yet")}
                    </Row>
                  )}
                </dl>
              </div>
              <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                <span className="text-[12px] font-semibold text-fg">On adding</span>
                <p className="text-[11.5px] leading-[1.55] text-dim">
                  The platform reads the issuer&rsquo;s published metadata again and keeps its endpoints and the address of its keys.{" "}
                  {step === 1
                    ? "What it is trusted for is chosen in step 2."
                    : upstream
                      ? "It is then registered with the issuer the way chosen here, and tool servers can be set to get their tokens from it."
                      : "From then on a service whose token it signed, for an admitted subject, is signed in on every request it sends. Removing the issuer later stops every workload from it."}
                </p>
              </div>
            </aside>
          </div>
        )}

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          {done ? (
            <>
              <span className="grow" />
              <Button size="sm" variant="solid" tone="neutral" permission="iam" onClick={again}>
                Add another
              </Button>
              <Button size="sm" variant="solid" tone="ink" onClick={onClose}>
                Show it in the list
              </Button>
            </>
          ) : (
            <>
              <span className="min-w-0 grow text-[11.5px] leading-[1.5] text-faint">{step === 1 ? (dirty ? atIssuer : "") : !failed ? atTrust || methodOff : ""}</span>
              <Button size="sm" variant="solid" tone="err" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              {step === 2 && (
                <Button size="sm" variant="solid" tone="neutral" onClick={() => setStep(1)} disabled={busy}>
                  Back
                </Button>
              )}
              {step === 1 ? (
                <Button size="sm" variant="solid" tone="ink" disabled={Boolean(atIssuer)} onClick={() => setStep(2)}>
                  Next: what it is trusted for
                </Button>
              ) : (
                <Button size="sm" variant="solid" tone="ink" permission="iam" disabled={Boolean(problem || methodOff)} loading={busy} onClick={() => void submit()}>
                  {busy ? "Adding…" : "Add authorization server"}
                </Button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
