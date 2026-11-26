"use client";
import { useDoorOff } from "@/lib/use-doors";
import { Failure } from "./pending";
import { notBuiltDoorOf } from "@/lib/api/client";

import { useEffect, useRef, useState } from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { Pick } from "./select";
import { ControlRef } from "./control-ref";
import { DigestChip } from "./digest-chip";
import { AddServerDialog } from "./add-server-dialog";
import { useSession } from "@/lib/use-session";
import { controlLabel } from "@/lib/guardrails";
import {
  addBody,
  addServer,
  approveServer,
  deleteServer,
  EMPTY_FORM,
  RegistryError,
  rescanServer,
  type AddForm,
  type McpServer,
  type RegisteredServer,
  type ScreenHit,
} from "@/lib/api/l6";
import { adoptedLine, approveAccess, changeLine, credentialsWaiting, formProblem, isolationLine, pinChange, pinnedTools, refusedWhen, rescanBlocked, RISKS, sendsOutside, STATUS_META, toolHints, toolRisk, type Me } from "@/lib/mcp-registry";

/**
 * The MCP registry: the tool servers this deployment connects, and whether
 * each may reach a run (`GET/POST /api/mcp`, `POST /api/mcp/{id}/approve`,
 * `/rescan`, `DELETE /api/mcp/{id}`).
 *
 * Registering is admission, not trust. A server is registered by its address
 * and the headers it is sent, each naming a vault credential. A server with
 * no headers is asked for its tool list at once; every tool's name,
 * description and schema is screened, and the list is pinned by digest. A
 * server whose headers name a vault credential is sent nothing at
 * registration: it waits, pending with no pin, until a platform admin other
 * than the one who registered it approves its address with those headers
 * (`POST /api/mcp/{id}/approve` with no body); only then is its list read
 * with them, screened (a 422 with the hits stores it as refused) and pinned.
 * Either way the server waits, pending, until a platform admin approves the
 * pin and sets each tool's risk (a tool left unset counts as destructive),
 * and only an approved pin attaches to a run. A rescan that finds a
 * different list marks the server changed and detaches it until it is
 * approved again.
 * Each row says which of those it is, the pin and the scan that stand behind
 * it (for a changed server, the approved list it moved away from and which
 * tools moved), who signed, whether it was adopted from before the registry
 * (never screened until it is approved) and whether it runs in a container.
 * Environment and header values never reach the console; their names are
 * listed so a reviewer knows what the server is handed. Every action needs
 * the configure permission, so a viewer reads all of this and changes none
 * of it. A server is added in a dialog (components/add-server-dialog.tsx),
 * which posts what the inline form below posts; the row it adds is marked
 * and brought into view.
 */

function ago(iso: string): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** The signer as a reader wants it: the name, the email kept for the hover. */
function who(by: string): string {
  return by.replace(/\s*<[^>]*>\s*$/, "").trim() || by || "unknown";
}

function meOf(session: { name: string; email: string; sub: string; appRoles?: string[] } | null): Me | null {
  return session ? { name: session.name, email: session.email, sub: session.sub, roles: session.appRoles ?? [] } : null;
}

/** A status as a chip: changed and refused are solid red, so they stop a reader scanning the list. */
export function ServerStatusTag({ status }: { status: McpServer["status"] }) {
  const meta = STATUS_META[status];
  return (
    <span title={meta.means}>
      <Tag tone={meta.tone} solid={meta.alarming}>
        {meta.label}
      </Tag>
    </span>
  );
}

/** The screener's findings: which tool, which field, which control, and what it saw. */
export function HitsTable({ hits }: { hits: ScreenHit[] }) {
  if (!hits.length) return null;
  return (
    <div className="overflow-x-auto rounded-sm border border-err-line">
      <table className="w-full min-w-[560px] border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-line bg-raise/60 text-left text-[10.5px] text-faint">
            <th className="px-3 py-1.5 font-medium">Tool</th>
            <th className="px-3 py-1.5 font-medium">Field</th>
            <th className="px-3 py-1.5 font-medium">Control</th>
            <th className="px-3 py-1.5 font-medium">What the screener saw</th>
          </tr>
        </thead>
        <tbody>
          {hits.map((h, i) => (
            <tr key={`${h.tool}-${h.field}-${i}`} className="border-b border-line align-top last:border-0">
              <td className="px-3 py-1.5 whitespace-nowrap">
                <Mono className="text-[10.5px] text-fg">{h.tool || "—"}</Mono>
              </td>
              <td className="px-3 py-1.5 whitespace-nowrap text-dim">{h.field}</td>
              <td className="px-3 py-1.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-fg">{controlLabel(h.control)}</span>
                  <Mono className="text-[10px] text-faint">{h.control}</Mono>
                  <ControlRef control={h.control} />
                </span>
              </td>
              <td className="px-3 py-1.5 leading-[1.5] break-words text-dim">{h.detail || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A refusal from the registry: the message, and the control it names in the register's words. */
function Refusal({ error, hideHits = false }: { error: RegistryError | Error; /** The row already lists the same hits under its refused status. */ hideHits?: boolean }) {
  if (notBuiltDoorOf(error.message)) return <Failure inline message={error.message} />;
  const control = error instanceof RegistryError ? error.control : "";
  const hits = error instanceof RegistryError && !hideHits ? error.hits : [];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex flex-wrap items-center gap-2 text-[11.5px] leading-[1.5] text-err">
        {control && <span className="font-medium">{controlLabel(control)}.</span>}
        <span>{error.message}</span>
        {control && <ControlRef control={control} />}
      </span>
      <HitsTable hits={hits} />
    </div>
  );
}

/* ═══════════════════ adding a server ═══════════════════ */

const INPUT = "focusable h-8 w-full rounded-md border border-line-strong bg-field px-2.5 text-[12.5px] text-fg placeholder:text-ghost";
const AREA = "focusable w-full resize-y rounded-md border border-line-strong bg-field px-2.5 py-1.5 font-mono text-[11.5px] leading-[1.5] text-fg placeholder:text-ghost";

/**
 * The add form in one piece, for a narrow rail; the list on Configuration
 * adds through the dialog instead (components/add-server-dialog.tsx), which
 * sends the same body (lib/api/l6.ts addBody): a remote server by its
 * address and the headers it is sent, each value naming a vault credential.
 * A 422 is the screener refusing admission (the hits, and the control); a
 * 502 is the server not answering; either way nothing reaches a run.
 */
export function AddServerForm({
  onAdded,
  onRefused,
  onCancel,
  stacked = false,
}: {
  onAdded: (s: McpServer) => void;
  /** The screener refused admission; the registry stored the server as `refused`, so the list has changed. */
  onRefused?: () => void;
  onCancel: () => void;
  /** One field per line, for the builder's narrow rail. */
  stacked?: boolean;
}) {
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RegistryError | Error | null>(null);
  const addDoor = useDoorOff("POST", "/api/mcp");
  const set = (patch: Partial<AddForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError(null);
  };
  const problem = formProblem(form);
  const cell = stacked ? "flex flex-col gap-1" : "flex min-w-0 grow basis-[200px] flex-col gap-1";

  const submit = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const server = await addServer(addBody(form));
      setForm(EMPTY_FORM);
      onAdded(server);
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

  return (
    <form
      className={`flex flex-col gap-2.5 ${stacked ? "rounded-md border border-line bg-surface p-2.5" : "border-b border-line bg-raise/40 px-4 py-3"}`}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <span className="text-[12px] font-semibold text-fg">Register a tool server</span>
      <div className={stacked ? "flex flex-col gap-2" : "flex flex-wrap items-end gap-2"}>
        <label className={cell}>
          <span className="text-[10.5px] text-ghost">Name</span>
          <input value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="Risk engine" className={INPUT} />
        </label>
        <label className={cell}>
          <span className="text-[10.5px] text-ghost">Id (optional)</span>
          <input value={form.id} onChange={(e) => set({ id: e.target.value })} placeholder="from the name" spellCheck={false} className={`${INPUT} font-mono text-[11.5px]`} />
        </label>
        <label className={cell}>
          <span className="text-[10.5px] text-ghost">Version (optional)</span>
          <input value={form.version} onChange={(e) => set({ version: e.target.value })} placeholder="1.4.2" spellCheck={false} className={`${INPUT} font-mono text-[11.5px]`} />
        </label>
      </div>
      <div className={stacked ? "flex flex-col gap-2" : "grid gap-2 md:grid-cols-2"}>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10.5px] text-ghost">Address it answers on</span>
          <input value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://tools.example.com/mcp" spellCheck={false} className={`${INPUT} font-mono text-[11.5px]`} />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10.5px] text-ghost">Headers, one Name: value per line (optional)</span>
          <textarea rows={2} value={form.headers} onChange={(e) => set({ headers: e.target.value })} placeholder={"Authorization: Bearer ${secret:tools-token}"} spellCheck={false} className={AREA} />
        </label>
      </div>
      <p className="text-[10.5px] leading-[1.5] text-faint">
        Each value names a vault credential as <Mono className="text-[10px]">{"${secret:name}"}</Mono>.
      </p>
      {error && <Refusal error={error} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="solid" tone="ink" permission="configure" disabled={Boolean(problem) || addDoor.off} title={addDoor.why} loading={busy}>
          {busy ? (form.headers.trim() ? "Registering…" : "Asking it for its tools…") : form.headers.trim() ? "Register" : "Register and scan"}
        </Button>
        <Button size="sm" variant="solid" tone="err" onClick={onCancel}>
          Cancel
        </Button>
        {!addDoor.off && problem && (form.label || form.url) && <span className="text-[11px] text-faint">{problem}</span>}
      </div>
    </form>
  );
}

/* ═══════════════════ one server ═══════════════════ */

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] text-ghost">{k}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-dim">{children}</span>
    </span>
  );
}

function Names({ names, none }: { names: string[]; none: string }) {
  if (!names.length) return <span className="text-ghost">{none}</span>;
  return (
    <>
      {names.map((n) => (
        <Mono key={n} className="rounded-[3px] bg-raise px-1 py-px text-[10px] text-fg">
          {n}
        </Mono>
      ))}
    </>
  );
}

const DATA_CLASSES = ["public", "internal", "confidential", "restricted"] as const;
const RISK_TEXT: Record<string, string> = {
  read: "read: reads only",
  write: "write: changes something",
  risky: "risky",
  destructive: "destructive: a platform admin approves every call",
};

/**
 * What a platform admin decides when approving a pin: each tool's risk, the
 * read tools that send data outside, and the most sensitive class of data
 * the server may be sent. A tool left unset is sent as unset, and the
 * platform counts it destructive: every call to it then waits for a platform
 * admin. A tool at write or above already counts as sending data outside, so
 * its box is ticked and fixed; only read tools are marked, and only those
 * are sent. The server's own hints are shown beside each tool as its word
 * about itself, and decide nothing.
 */
function RiskApproval({ server: s, busy, onApprove, onCancel }: { server: RegisteredServer; busy: boolean; onApprove: (risks: Record<string, string>, cls: string, outbound: string[]) => void; onCancel: () => void }) {
  const tools = pinnedTools(s);
  const [risks, setRisks] = useState<Record<string, string>>(() => Object.fromEntries(tools.map((t) => [t.name, toolRisk(t).set ? toolRisk(t).risk : ""])));
  const [marked, setMarked] = useState<Record<string, boolean>>(() => Object.fromEntries(tools.map((t) => [t.name, t.outbound === true])));
  const [cls, setCls] = useState(s.max_data_class || "public");
  const unset = tools.filter((t) => !risks[t.name]).length;
  // A tool counts as read only when its risk is set to read; unset is destructive.
  const isRead = (name: string) => risks[name] === "read";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-canvas p-3">
      <span className="flex flex-wrap items-baseline gap-2">
        <span className="text-[12px] font-semibold text-fg">{s.status === "approved" ? "Change the risks of the approved list" : "Approve the pinned list"}</span>
        <span className="text-[11px] text-faint">a tool left unset is destructive</span>
      </span>
      <span className="text-[11px] leading-[1.5] text-dim">
        Tick &ldquo;Sends data outside&rdquo; for a read tool that forwards its input.
      </span>
      <div className="overflow-x-auto rounded-sm border border-line">
        <table className="w-full min-w-[720px] border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line bg-raise/60 text-left text-[10.5px] text-faint">
              <th className="px-3 py-1.5 font-medium">Tool</th>
              <th className="px-3 py-1.5 font-medium">The server&rsquo;s hints say</th>
              <th className="px-3 py-1.5 font-medium">Risk</th>
              <th className="px-3 py-1.5 font-medium">Sends data outside</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => {
              const h = toolHints(t);
              const read = isRead(t.name);
              return (
                <tr key={t.name} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-1.5">
                    <span className="flex flex-col gap-0.5">
                      <Mono className="text-[11px] text-fg">{t.name}</Mono>
                      {t.description && <span className="line-clamp-2 max-w-[52ch] text-[10.5px] text-faint">{t.description}</span>}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-dim">
                    {h.risk}
                    {h.hints.length ? <span className="block text-[10px] text-faint">{h.hints.join(", ")}</span> : <span className="block text-[10px] text-faint">no hints</span>}
                  </td>
                  <td className="w-[230px] px-3 py-1.5">
                    <Pick
                      value={risks[t.name] ?? ""}
                      onChange={(v) => setRisks((r) => ({ ...r, [t.name]: v }))}
                      aria-label={`Risk of ${t.name}`}
                      options={[{ value: "", label: "Not set: destructive" }, ...RISKS.map((r) => ({ value: r, label: RISK_TEXT[r] ?? r }))]}
                    />
                  </td>
                  <td className="w-[150px] px-3 py-1.5">
                    <label
                      className={`inline-flex items-center gap-1.5 ${read ? "cursor-pointer text-fg" : "cursor-not-allowed text-faint"}`}
                      title={read ? "Tick it when this read tool passes what it is given on to another system" : "At write or above it already counts as sending data outside"}
                    >
                      <input
                        type="checkbox"
                        checked={read ? marked[t.name] === true : true}
                        disabled={!read}
                        onChange={(e) => setMarked((m) => ({ ...m, [t.name]: e.target.checked }))}
                        aria-label={`${t.name} sends data outside`}
                        className="accent-[var(--t-fg)]"
                      />
                      <span className="text-[11px]">{read ? (marked[t.name] ? "yes, marked" : "no") : "yes, by its risk"}</span>
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-dim">Most sensitive data it may be sent</span>
        <span className="block w-[170px]">
          <Pick value={cls} onChange={setCls} aria-label="Most sensitive data the server may be sent" options={DATA_CLASSES.map((c) => ({ value: c, label: c }))} />
        </span>
        <span className="grow" />
        <Button size="sm" variant="solid" tone="err" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="solid"
          tone="ink"
          permission="configure"
          loading={busy}
          onClick={() => onApprove(Object.fromEntries(Object.entries(risks).filter(([, v]) => v)), cls, tools.filter((t) => isRead(t.name) && marked[t.name]).map((t) => t.name))}
        >
          {s.status === "approved" ? "Save the risks" : `Approve${unset ? `, ${unset} left destructive` : ""}`}
        </Button>
      </span>
    </div>
  );
}

/**
 * What a second platform admin approves for a server whose headers name the
 * vault: sending those credentials to that address. Nothing has been sent to
 * the server before this. The call carries no body; the list is read with
 * the credentials straight after, screened and pinned, and its tools' risks
 * are set later, when the pin is approved.
 */
function CredentialsApproval({ server: s, busy, onApprove, onCancel }: { server: RegisteredServer; busy: boolean; onApprove: () => void; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-canvas p-3">
      <span className="text-[12px] font-semibold text-fg">Approve the address and its credentials</span>
      <span className="text-[11.5px] leading-[1.55] text-dim">
        Sends{" "}
        {s.credentials.length ? (
          <>
            the vault credential{s.credentials.length === 1 ? "" : "s"} <Names names={s.credentials} none="" />
          </>
        ) : (
          "its headers"
        )}{" "}
        in the header{s.header_names.length === 1 ? "" : "s"} <Names names={s.header_names} none="none" /> to <Mono className="text-[11px] text-fg">{s.url ?? "its address"}</Mono>, then reads its tool list.
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="grow" />
        <Button size="sm" variant="solid" tone="err" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" variant="solid" tone="ink" permission="configure" loading={busy} onClick={onApprove}>
          {busy ? "Sending the credentials and reading its tools…" : "Approve and read its tools"}
        </Button>
      </span>
    </div>
  );
}

function ServerRow({ server: s, twoPerson, me, onChanged, fresh = false }: { server: RegisteredServer; twoPerson: boolean; me: Me | null; onChanged: () => void; /** Added a moment ago, in this window: marked, and scrolled to once. */ fresh?: boolean }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fresh) row.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [fresh]);
  const [busy, setBusy] = useState<"approve" | "credentials" | "rescan" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** The risk table is open (approving, or changing the risks of an approved list), or the credentials approval for a server whose credentials wait. */
  const [deciding, setDeciding] = useState(false);
  const waiting = credentialsWaiting(s);
  const noRescan = rescanBlocked(s);
  const approveDoor = useDoorOff("POST", "/api/mcp/{id}/approve");
  const rescanDoor = useDoorOff("POST", "/api/mcp/{id}/rescan");
  const deleteDoor = useDoorOff("DELETE", "/api/mcp/{id}");
  const [error, setError] = useState<RegistryError | Error | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const meta = STATUS_META[s.status];
  const access = approveAccess(s, me, twoPerson);
  const tools = pinnedTools(s);
  const change = pinChange(s);
  const where = s.transport === "http" ? s.url ?? "" : [s.command, ...(s.args ?? [])].filter(Boolean).join(" ");
  const approval = s.approvals.at(-1);
  const isolated = isolationLine(s);

  const act = async (what: "approve" | "credentials" | "rescan" | "delete", decided?: { risks: Record<string, string>; cls: string; outbound: string[] }) => {
    setBusy(what);
    setError(null);
    setNotice(null);
    try {
      if (what === "credentials") {
        // No body: the approval is of the address with its headers; risks are set when the pin is approved.
        const after = await approveServer(s.id);
        const n = pinnedTools(after).length;
        setDeciding(false);
        setNotice({
          tone: "ok",
          text: `Credentials approved: ${n} tool${n === 1 ? "" : "s"} pinned, waiting for pin approval.`,
        });
      } else if (what === "approve") {
        const set = Object.keys(decided?.risks ?? {}).length;
        const left = tools.length - set;
        // The marks are sent only when there are any: an approval that names none marks none.
        const outbound = decided?.outbound ?? [];
        await approveServer(s.id, decided ? { risks: decided.risks, max_data_class: decided.cls, ...(outbound.length ? { outbound } : {}) } : undefined);
        setDeciding(false);
        setNotice({
          tone: "ok",
          text: `Approved${left ? `; ${left} tool${left === 1 ? "" : "s"} left destructive` : ""}.`,
        });
      } else if (what === "rescan") {
        const r = await rescanServer(s.id);
        setNotice(
          !r.changed
            ? { tone: "ok", text: "Rescanned: the tool list still matches the pin." }
            : r.server.status === "refused"
              ? { tone: "err", text: "Rescanned: the screener refused the new list; the server is detached." }
              : r.server.status === "pending"
                ? { tone: "ok", text: "Rescanned: the new list is pinned and waits for approval." }
                : { tone: "err", text: "Tool list changed — re-approval needed." },
        );
      } else {
        await deleteServer(s.id);
        setConfirming(false);
      }
      onChanged();
    } catch (e) {
      // Each refusal is shown in the registry's own words, with the screener's
      // hits when it names them. The registry moved under the click: a list
      // refused by the screener when it was read on approval (422, stored as
      // refused), a list that could not be read once the credentials were
      // approved (502: the approval stands, a rescan reads it), a server
      // refused or approved elsewhere (409), one removed elsewhere (404).
      // Read it again.
      setError(e as Error);
      if (e instanceof RegistryError && (what === "credentials" || what === "approve") && [409, 422, 502].includes(e.status)) setDeciding(false);
      if (e instanceof RegistryError && [404, 409, 422, 502].includes(e.status)) onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={row} className={`relative flex scroll-mt-4 flex-col gap-2.5 border-b border-line px-4 py-3 last:border-0 ${meta.alarming ? "bg-err-bg/40" : fresh ? "bg-raise/50" : ""}`}>
      {meta.alarming ? <span className="absolute inset-y-0 left-0 w-[3px] bg-err" aria-hidden /> : fresh ? <span className="absolute inset-y-0 left-0 w-[3px] bg-warn" aria-hidden /> : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-[12.5px] font-semibold text-fg">{s.label}</span>
        <Mono className="text-[10.5px] text-faint">{s.id}</Mono>
        <ServerStatusTag status={s.status} />
        <Tag>{s.transport === "http" ? "HTTP" : "stdio"}</Tag>
        {fresh && <Tag tone="warn">Just added</Tag>}
        {isolated && (
          <span title={isolated} className="inline-flex">
            <Tag tone="ok">Isolated</Tag>
          </span>
        )}
        {s.adopted && (
          <span title={adoptedLine(s)} className="inline-flex">
            <Tag tone="warn">Adopted</Tag>
          </span>
        )}
        {s.version && <Mono className="text-[10.5px] text-faint">v{s.version}</Mono>}
        <span className="grow" />
        {confirming ? (
          <span className="inline-flex items-center gap-1.5">
            <Button size="sm" variant="solid" tone="err" permission="configure" loading={busy === "delete"} onClick={() => act("delete")}>
              Delete now
            </Button>
            <Button size="sm" variant="solid" tone="neutral" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
            {s.status !== "refused" && (
              <Button size="sm" variant="solid" tone={s.status === "approved" ? "neutral" : "ink"} permission="configure" disabled={!access.ok || busy !== null || deciding || approveDoor.off} title={approveDoor.why} loading={busy === "approve" || busy === "credentials"} onClick={() => setDeciding(true)}>
                {waiting ? "Approve the address and its credentials" : s.status === "approved" ? "Change risks" : s.status === "changed" ? "Approve new list" : "Approve"}
              </Button>
            )}
            <Button size="sm" variant="solid" tone="neutral" permission="configure" disabled={busy !== null || rescanDoor.off || Boolean(noRescan)} title={rescanDoor.why || noRescan || undefined} loading={busy === "rescan"} onClick={() => act("rescan")}>
              Rescan
            </Button>
            <Button size="sm" variant="solid" tone="err" permission="configure" disabled={busy !== null || deleteDoor.off} title={deleteDoor.why} onClick={() => setConfirming(true)}>
              Delete
            </Button>
          </span>
        )}
      </div>
      {s.status !== "refused" && !access.ok && access.reason && (
        <span className="-mt-1 self-end text-[11px] text-warn">{access.reason}</span>
      )}
      {deciding && access.ok && access.credentials && <CredentialsApproval server={s} busy={busy === "credentials"} onCancel={() => setDeciding(false)} onApprove={() => void act("credentials")} />}
      {deciding && access.ok && !access.credentials && <RiskApproval server={s} busy={busy === "approve"} onCancel={() => setDeciding(false)} onApprove={(risks, cls, outbound) => void act("approve", { risks, cls, outbound })} />}

      {where && <Mono className="block truncate text-[10.5px] text-ghost">{where}</Mono>}
      {waiting && <span className="text-[11px] leading-[1.5] text-warn">Nothing sent yet: its credentials wait for a second platform admin.</span>}
      {isolated && <span className="text-[11px] leading-[1.5] text-faint">Runs {isolated}.</span>}

      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
        <Fact k={s.status === "changed" ? "Pin (new list, waiting)" : "Pin"}>
          {s.pin ? (
            <>
              <DigestChip digest={s.pin.digest} label="Pin" />
              <span>
                {tools.length} tool{tools.length === 1 ? "" : "s"} · pinned {ago(s.pin.at)}
              </span>
            </>
          ) : (
            <span className="text-ghost">{waiting ? "none: its list has not been read" : "no pin"}</span>
          )}
        </Fact>
        <Fact k="Last scan">
          {s.last_scan && !s.last_scan.digest && s.last_scan.note ? (
            // A registration whose credentials wait carries a scan that read nothing: its note says so, and no time is given as if a list had been read.
            <span className="leading-[1.5]">{s.last_scan.note.split(":")[0]}</span>
          ) : s.last_scan ? (
            <span title={`${s.last_scan.by}${s.last_scan.server ? `\nThe server reported itself as ${s.last_scan.server.name}${s.last_scan.server.version ? ` ${s.last_scan.server.version}` : ""}` : ""}`}>
              {ago(s.last_scan.at)} by {who(s.last_scan.by)}
            </span>
          ) : (
            <span className="text-ghost">
              {!s.adopted ? "never scanned" : s.status === "approved" ? "none on record: screened when it was approved" : "never scanned: adopted, not yet screened"}
            </span>
          )}
        </Fact>
        <Fact k="Approved">
          {approval ? (
            <span title={`${approval.by}${approval.digest ? `\nApproved the pin ${approval.digest}` : ""}`}>
              by {who(approval.by)} · {ago(approval.at)}
            </span>
          ) : (
            <span className="text-ghost">{waiting ? "not yet: its credentials wait first" : "not yet"}</span>
          )}
          {s.credentials_approval && (
            <span title={s.credentials_approval.by}>
              · credentials approved by {who(s.credentials_approval.by)} {ago(s.credentials_approval.at)}
            </span>
          )}
          {s.adopted ? (
            <span className="text-ghost" title={adoptedLine(s)}>
              · adopted {ago(s.adopted.at)}
            </span>
          ) : (
            <span className="text-ghost" title={s.added_by}>
              · registered by {who(s.added_by)}
              {s.added_at ? ` ${ago(s.added_at)}` : ""}
            </span>
          )}
        </Fact>
        <Fact k={s.transport === "http" ? "Headers (names only)" : "Environment (names only)"}>
          <Names names={s.transport === "http" ? s.header_names : s.env_names} none="none" />
          {s.credentials.length > 0 && <span className="text-ghost">· vault: {s.credentials.join(", ")}</span>}
        </Fact>
        {(s.timeout_s !== null || s.max_data_class || s.protocol) && (
          <Fact k="Calls">
            {s.timeout_s !== null && <span>at most {s.timeout_s} s each</span>}
            {s.max_data_class && <span>· sent up to {s.max_data_class} data</span>}
            {s.protocol && <Mono className="text-[10px] text-faint">· MCP {s.protocol}</Mono>}
          </Fact>
        )}
      </div>

      {tools.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[10px] text-ghost">{s.status === "changed" ? "New tool list" : "Pinned tools"}</span>
          {tools.map((t) => {
            const h = toolHints(t);
            const r = toolRisk(t);
            const out = sendsOutside(t);
            const moved = change?.rewritten.includes(t.name) || change?.added.includes(t.name);
            const outLine =
              out.sends === null
                ? ""
                : out.sends
                  ? `\nSends data outside${r.risk === "read" ? " (marked when the pin was approved)" : ` (its risk is ${r.risk})`}: untrusted content may not reach it.`
                  : "\nNot marked as sending data outside: untrusted content may reach it.";
            return (
              <span
                key={t.name}
                title={`${t.description || t.name}\n${r.set ? `Risk ${r.risk}, set when the pin was approved.` : "No risk set for this pin: the platform counts it destructive, and every call waits for a platform admin."}${outLine}\nThe server's hints say ${h.risk}${h.hints.length ? ` (${h.hints.join(", ")})` : ""}.`}
                className={`inline-flex items-center gap-1 rounded-[3px] border bg-surface px-1 py-px font-mono text-[10px] ${moved ? "border-err text-err" : "border-line text-dim"}`}
              >
                {t.name}
                <span className={r.risk === "destructive" ? "text-err" : r.risk === "read" ? "text-ok" : "text-faint"}>
                  · {r.risk}
                  {r.set ? "" : " (not set)"}
                </span>
                {r.risk === "read" && out.marked && <span className="text-warn">· sends outside</span>}
              </span>
            );
          })}
        </div>
      )}
      {(s.last_scan?.excluded?.length ?? 0) > 0 && (
        <span className="text-[11px] leading-[1.5] text-faint">
          Left out of the pin:{" "}
          {s.last_scan!.excluded!.map((x, i) => (
            <span key={i}>
              {i > 0 && "; "}
              <Mono className="text-[10.5px] text-dim">{x.tool}</Mono> ({x.reason})
            </span>
          ))}
        </span>
      )}

      {s.status === "changed" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11.5px] leading-[1.5] font-medium text-err">Tool list changed — re-approval needed.</p>
          {change && (
            <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
              <span>Approved</span>
              <DigestChip digest={change.from} label="Approved pin" />
              <span>→ found</span>
              <DigestChip digest={change.to} label="New pin" />
              {changeLine(change) && <span className="text-err">· {changeLine(change)}</span>}
            </span>
          )}
        </div>
      )}
      {s.status === "refused" && (
        <div className="flex flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2 text-[11.5px] font-medium text-err">
            {controlLabel("screener")}
            <ControlRef control="screener" />
          </span>
          {s.previous_pin && (
            <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
              <span>
                {refusedWhen(s) === "when it was approved"
                  ? "Refused on approval; it was pinned on"
                  : s.approvals.some((a) => a.digest === s.previous_pin?.digest)
                    ? "Refused on a rescan; the list approved before was"
                    : "Refused on a rescan; it had been pinned on"}
              </span>
              <DigestChip digest={s.previous_pin.digest} label="Previous pin" />
              {s.last_scan?.digest && s.last_scan.digest !== s.previous_pin.digest && (
                <>
                  <span>→ refused</span>
                  <DigestChip digest={s.last_scan.digest} label="Refused list" />
                </>
              )}
            </span>
          )}
          {s.last_scan?.hits.length ? <HitsTable hits={s.last_scan.hits} /> : <span className="text-[11px] text-faint">The screener named no hit on the stored scan.</span>}
        </div>
      )}

      {notice && <p className={`text-[11.5px] leading-[1.5] ${notice.tone === "ok" ? "text-ok" : "font-medium text-err"}`}>{notice.text}</p>}
      {error && <Refusal error={error} hideHits={s.status === "refused" && (s.last_scan?.hits.length ?? 0) > 0} />}
    </div>
  );
}

/* ═══════════════════ the panel body ═══════════════════ */

export function ToolServers({
  servers,
  twoPerson,
  error,
  refresh,
}: {
  servers: RegisteredServer[] | null;
  twoPerson: boolean;
  error: string;
  refresh: () => void;
}) {
  const { session } = useSession();
  const me = meOf(session);
  const [adding, setAdding] = useState(false);
  const addDoor = useDoorOff("POST", "/api/mcp");
  const [added, setAdded] = useState<RegisteredServer | null>(null);
  // Alarms first, then what waits for a person, then what is in service.
  const order: McpServer["status"][] = ["changed", "refused", "pending", "approved"];
  // The row just added shows at once, from the door's own answer, until the list read after it carries it.
  const listed = servers ?? [];
  const rows = added && servers !== null && !listed.some((s) => s.id === added.id) ? [...listed, added] : listed;
  const count = (st: McpServer["status"]) => rows.filter((s) => s.status === st).length;
  const shown = [...rows].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.label.localeCompare(b.label));
  /** The registry was not read: no counts and no two-person claim, only the failure. */
  const unread = Boolean(error) && rows.length === 0;

  return (
    <div className="flex flex-col">
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 ${unread ? "" : "border-b border-line"}`}>
        {servers === null ? (
          <span className="text-[11px] text-faint">Reading the registry…</span>
        ) : unread ? (
          <span className="text-[11.5px] leading-[1.5] text-faint">Not read.</span>
        ) : (
          <span className="flex flex-wrap items-center gap-3">
            <Status tone="ok">{count("approved")} approved</Status>
            <Status tone="warn">{count("pending")} pending</Status>
            <Status tone={count("changed") ? "err" : "neutral"}>{count("changed")} changed</Status>
            <Status tone={count("refused") ? "err" : "neutral"}>{count("refused")} refused</Status>
          </span>
        )}
        {!unread && twoPerson && <span className="min-w-0 max-w-[70ch] text-[11px] leading-[1.5] text-faint">Two-person approval is on.</span>}
        <span className="grow" />
        <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={addDoor.off} title={addDoor.why} onClick={() => setAdding(true)}>
          Add a server
        </Button>
      </div>

      {adding && (
        <AddServerDialog
          twoPerson={twoPerson}
          onClose={() => setAdding(false)}
          onAdded={(s) => {
            setAdded(s as RegisteredServer);
            refresh();
          }}
          onRefused={refresh}
          renderRefusal={(e) => <Refusal error={e} />}
        />
      )}
      {added && credentialsWaiting(added) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/40 px-4 py-2">
          <Status tone="warn">{added.label} registered</Status>
          <span className="min-w-0 grow text-[11px] leading-[1.5] text-faint">Nothing sent yet: a second platform admin approves its credentials.</span>
          <Button size="sm" variant="solid" tone="neutral" onClick={() => setAdded(null)}>
            Dismiss
          </Button>
        </div>
      )}
      {added && !credentialsWaiting(added) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/40 px-4 py-2">
          <Status tone="warn">{added.label} admitted</Status>
          <span className="text-[11px] text-faint">
            {pinnedTools(added).length} tool{pinnedTools(added).length === 1 ? "" : "s"} pinned
          </span>
          {added.pin && <DigestChip digest={added.pin.digest} label="Pin" />}
          <span className="text-[11px] text-faint">pending approval</span>
          <span className="grow" />
          <Button size="sm" variant="solid" tone="neutral" onClick={() => setAdded(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {error && <Failure className="border-b border-line px-4 py-2.5" message={error} what="The tool server registry could not be read" />}
      {shown.map((s) => (
        <ServerRow
          key={s.id}
          server={s}
          twoPerson={twoPerson}
          me={me}
          fresh={!adding && added?.id === s.id}
          onChanged={() => {
            // A row removed must not come back from the answer that added it.
            setAdded((a) => (a?.id === s.id ? null : a));
            refresh();
          }}
        />
      ))}
      {servers !== null && shown.length === 0 && !error && (
        <p className="px-4 py-3 text-[11.5px] text-faint">No tool server is registered.</p>
      )}
    </div>
  );
}
