"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { QuietNote } from "./overlays";
import { QUIET } from "@/lib/quiet";
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
  type ScreenHit,
  type Transport,
} from "@/lib/api/l6";
import { adoptedLine, approveAccess, changeLine, formProblem, isolationLine, pinChange, pinnedTools, refusedWhen, STATUS_META, toolHints, type Me } from "@/lib/mcp-registry";

/**
 * The MCP registry: the tool servers this deployment connects, and whether
 * each may reach a run (phase L6, backend/CONTRACT.md "The MCP registry
 * door").
 *
 * Registering is admission, not trust. Adding a server starts it once,
 * screens every tool's name, description and schema, and pins the tool list
 * by digest; the server waits, pending, until a person approves the pin, and
 * only an approved pin attaches to a run. A rescan that finds a different
 * list marks the server changed and detaches it until someone approves again.
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

function meOf(session: { name: string; email: string; sub: string } | null): Me | null {
  return session ? { name: session.name, email: session.email, sub: session.sub } : null;
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
function Refusal({ error }: { error: RegistryError | Error }) {
  // A quiet console (lib/quiet.ts) does not print why the registry did not answer; a refusal that names a control or carries screening hits is content and stays.
  if (QUIET && !(error instanceof RegistryError && (error.control || error.hits.length))) return <QuietNote inline />;
  const control = error instanceof RegistryError ? error.control : "";
  const hits = error instanceof RegistryError ? error.hits : [];
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
 * sends the same body. It posts the
 * contract's body (lib/api/l6.ts addBody): a stdio server by its command
 * line and KEY=VALUE environment, an HTTP server by its URL and headers.
 * Values are typed here and sent once; the registry never hands them back.
 * A 422 is the screener refusing admission (the hits, and the control); a
 * 502 is the server failing to start or answer; either way nothing reaches
 * a run.
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
  const set = (patch: Partial<AddForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError(null);
  };
  const problem = formProblem(form);
  const stdio = form.transport === "stdio";
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
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-fg">Register a tool server</span>
        <span className="text-[10.5px] text-faint">started once to list its tools, screened, then pinned; nothing attaches until the pin is approved</span>
      </span>
      <div className={stacked ? "flex flex-col gap-2" : "flex flex-wrap items-end gap-2"}>
        <label className={cell}>
          <span className="text-[10.5px] text-ghost">Name</span>
          <input value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="Risk engine" className={INPUT} />
        </label>
        <label className={cell}>
          <span className="text-[10.5px] text-ghost">Id (optional)</span>
          <input value={form.id} onChange={(e) => set({ id: e.target.value })} placeholder="from the name" spellCheck={false} className={`${INPUT} font-mono text-[11.5px]`} />
        </label>
        <span className={cell}>
          <span className="text-[10.5px] text-ghost">Transport</span>
          <span role="radiogroup" aria-label="Transport" className="inline-flex h-8 items-center gap-px self-start rounded-md border border-line bg-raise p-px">
            {(["stdio", "http"] as Transport[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={form.transport === t}
                onClick={() => set({ transport: t })}
                className={`focusable h-full cursor-pointer rounded-sm px-2.5 text-[12px] whitespace-nowrap transition-colors ${
                  form.transport === t ? "bg-surface font-medium text-fg shadow-[var(--shadow-1)]" : "text-faint hover:text-dim"
                }`}
              >
                {t === "stdio" ? "Command (stdio)" : "URL (HTTP)"}
              </button>
            ))}
          </span>
        </span>
        <label className={cell}>
          <span className="text-[10.5px] text-ghost">Version (optional)</span>
          <input value={form.version} onChange={(e) => set({ version: e.target.value })} placeholder="1.4.2" spellCheck={false} className={`${INPUT} font-mono text-[11.5px]`} />
        </label>
      </div>
      <div className={stacked ? "flex flex-col gap-2" : "grid gap-2 md:grid-cols-2"}>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10.5px] text-ghost">{stdio ? "Command line that starts it" : "URL it answers on"}</span>
          {stdio ? (
            <input value={form.command} onChange={(e) => set({ command: e.target.value })} placeholder="python3 tools/risk_server.py" spellCheck={false} className={`${INPUT} font-mono text-[11.5px]`} />
          ) : (
            <input value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://tools.example.com/mcp" spellCheck={false} className={`${INPUT} font-mono text-[11.5px]`} />
          )}
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10.5px] text-ghost">{stdio ? "Environment, one KEY=VALUE per line (optional)" : "Headers, one Name: value per line (optional)"}</span>
          {stdio ? (
            <textarea rows={2} value={form.env} onChange={(e) => set({ env: e.target.value })} placeholder={"API_BASE=https://…\nAPI_KEY=${secret:risk-key}"} spellCheck={false} className={AREA} />
          ) : (
            <textarea rows={2} value={form.headers} onChange={(e) => set({ headers: e.target.value })} placeholder={"Authorization: Bearer ${secret:tools-token}"} spellCheck={false} className={AREA} />
          )}
        </label>
      </div>
      {stdio && (
        <div className={stacked ? "flex flex-col gap-2" : "grid gap-2 md:grid-cols-2"}>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[10.5px] text-ghost">Run it in a container: image (optional)</span>
            <input value={form.image} onChange={(e) => set({ image: e.target.value })} placeholder="registry.example/risk-server:1.4" spellCheck={false} className={`${INPUT} font-mono text-[11.5px]`} />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[10.5px] text-ghost">Container network (optional; none when blank)</span>
            <input value={form.network} onChange={(e) => set({ network: e.target.value })} placeholder="none" spellCheck={false} className={`${INPUT} font-mono text-[11.5px]`} />
          </label>
        </div>
      )}
      <p className="text-[10.5px] leading-[1.5] text-faint">
        Values are sent once and kept by the registry; only their names are shown again. Reference the vault as{" "}
        <Mono className="text-[10px]">{"${secret:name}"}</Mono> rather than pasting a credential.
        {stdio && " With an image, the server is discovered and run in that container, read-only and with every capability dropped, at admission as at every run."}
      </p>
      {error && <Refusal error={error} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="solid" tone="ink" permission="configure" disabled={Boolean(problem)} loading={busy}>
          {busy ? "Starting it and listing its tools…" : "Register and scan"}
        </Button>
        <Button size="sm" variant="solid" tone="err" onClick={onCancel}>
          Cancel
        </Button>
        {problem && (form.label || form.command || form.url) && <span className="text-[11px] text-faint">{problem}</span>}
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

function ServerRow({ server: s, twoPerson, me, onChanged, fresh = false }: { server: McpServer; twoPerson: boolean; me: Me | null; onChanged: () => void; /** Added a moment ago, in this window: marked, and scrolled to once. */ fresh?: boolean }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fresh) row.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [fresh]);
  const [busy, setBusy] = useState<"approve" | "rescan" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<RegistryError | Error | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const meta = STATUS_META[s.status];
  const access = approveAccess(s, me, twoPerson);
  const tools = pinnedTools(s);
  const change = pinChange(s);
  const where = s.transport === "http" ? s.url ?? "" : [s.command, ...(s.args ?? [])].filter(Boolean).join(" ");
  const approval = s.approvals.at(-1);
  const isolated = isolationLine(s);

  const act = async (what: "approve" | "rescan" | "delete") => {
    setBusy(what);
    setError(null);
    setNotice(null);
    try {
      if (what === "approve") {
        await approveServer(s.id);
        setNotice({ tone: "ok", text: "Pin approved: its tools attach to runs from now on." });
      } else if (what === "rescan") {
        const r = await rescanServer(s.id);
        setNotice(
          !r.changed
            ? { tone: "ok", text: "Rescanned: the tool list still matches the pin." }
            : r.server.status === "refused"
              ? { tone: "err", text: "Rescanned: the screener refused the list it found. The server is detached; the hits are below." }
              : r.server.status === "pending"
                ? { tone: "ok", text: "Rescanned: the list it found is clean and pinned; it waits for an approval." }
                : { tone: "err", text: "Tool list changed — re-approval needed. The server is detached until someone approves the new list." },
        );
      } else {
        await deleteServer(s.id);
        setConfirming(false);
      }
      onChanged();
    } catch (e) {
      // The registry moved under the click: an adopted entry screened on
      // approval and refused (422; the row shows the hits once it is read
      // again), a server refused or approved elsewhere (409), one removed
      // elsewhere (404). Read it again.
      if (e instanceof RegistryError && e.status === 422 && e.server?.status === "refused") setNotice({ tone: "err", text: e.message });
      else setError(e as Error);
      if (e instanceof RegistryError && [404, 409, 422].includes(e.status)) onChanged();
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
            {s.status !== "approved" && (
              <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={!access.ok || busy !== null} loading={busy === "approve"} onClick={() => act("approve")}>
                {s.status === "changed" ? "Approve new list" : "Approve"}
              </Button>
            )}
            <Button size="sm" variant="solid" tone="neutral" permission="configure" disabled={busy !== null} loading={busy === "rescan"} onClick={() => act("rescan")}>
              Rescan
            </Button>
            <Button size="sm" variant="solid" tone="err" permission="configure" disabled={busy !== null} onClick={() => setConfirming(true)}>
              Delete
            </Button>
          </span>
        )}
      </div>
      {s.status !== "approved" && !access.ok && access.reason && (
        <span className="-mt-1 self-end text-[11px] text-warn">{access.reason}</span>
      )}

      {where && <Mono className="block truncate text-[10.5px] text-ghost">{where}</Mono>}
      <span className="text-[11px] leading-[1.5] text-faint">{meta.means}.</span>
      {s.adopted && <span className="text-[11px] leading-[1.5] text-warn">This entry was {adoptedLine(s)}.</span>}
      {isolated && <span className="text-[11px] leading-[1.5] text-faint">Runs {isolated}, at discovery as at every run.</span>}

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
            <span className="text-ghost">no pin</span>
          )}
        </Fact>
        <Fact k="Last scan">
          {s.last_scan ? (
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
            <span className="text-ghost">not yet</span>
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
        </Fact>
      </div>

      {tools.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[10px] text-ghost">{s.status === "changed" ? "New tool list" : "Pinned tools"}</span>
          {tools.map((t) => {
            const h = toolHints(t);
            const moved = change?.rewritten.includes(t.name) || change?.added.includes(t.name);
            return (
              <span
                key={t.name}
                title={`${t.description || t.name}${h.hints.length ? `\nHints: ${h.hints.join(", ")}` : "\nNo hints: the builder seeds it as write"}`}
                className={`inline-flex items-center gap-1 rounded-[3px] border bg-surface px-1 py-px font-mono text-[10px] ${moved ? "border-err text-err" : "border-line text-dim"}`}
              >
                {t.name}
                <span className={h.risk === "destructive" ? "text-err" : h.risk === "read" ? "text-ok" : "text-faint"}>· {h.risk}</span>
              </span>
            );
          })}
        </div>
      )}

      {s.status === "changed" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11.5px] leading-[1.5] font-medium text-err">
            Tool list changed — re-approval needed. A rescan found a list other than the one approved and pinned it, waiting; the runtime will not attach this server until someone approves the new list.
          </p>
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
                  ? "Refused when someone approved it: the screener read the list it was pinned on"
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
      {error && <Refusal error={error} />}
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
  servers: McpServer[] | null;
  twoPerson: boolean;
  error: string;
  refresh: () => void;
}) {
  const { session } = useSession();
  const me = meOf(session);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<McpServer | null>(null);
  // Alarms first, then what waits for a person, then what is in service.
  const order: McpServer["status"][] = ["changed", "refused", "pending", "approved"];
  // The row just added shows at once, from the door's own answer, until the list read after it carries it.
  const listed = servers ?? [];
  const rows = added && servers !== null && !listed.some((s) => s.id === added.id) ? [...listed, added] : listed;
  const count = (st: McpServer["status"]) => rows.filter((s) => s.status === st).length;
  const shown = [...rows].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.label.localeCompare(b.label));
  /** Quiet (lib/quiet.ts): the registry was not read, so no counts and no two-person claim: one calm line beside the button. */
  const unread = QUIET && Boolean(error) && rows.length === 0;

  return (
    <div className="flex flex-col">
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 ${unread ? "" : "border-b border-line"}`}>
        {servers === null ? (
          <span className="text-[11px] text-faint">Reading the registry…</span>
        ) : unread ? (
          <QuietNote inline />
        ) : (
          <span className="flex flex-wrap items-center gap-3">
            <Status tone="ok">{count("approved")} approved</Status>
            <Status tone="warn">{count("pending")} pending</Status>
            <Status tone={count("changed") ? "err" : "neutral"}>{count("changed")} changed</Status>
            <Status tone={count("refused") ? "err" : "neutral"}>{count("refused")} refused</Status>
          </span>
        )}
        {!unread && <span className="min-w-0 max-w-[70ch] text-[11px] leading-[1.5] text-faint">
          {twoPerson
            ? "Two-person approval is on: whoever registers a server cannot approve its pin."
            : "One approval admits a server; two-person approval is off on this deployment."}
        </span>}
        <span className="grow" />
        <Button size="sm" variant="solid" tone="ink" permission="configure" onClick={() => setAdding(true)}>
          Add a server
        </Button>
      </div>

      {adding && (
        <AddServerDialog
          twoPerson={twoPerson}
          onClose={() => setAdding(false)}
          onAdded={(s) => {
            setAdded(s);
            refresh();
          }}
          onRefused={refresh}
          renderRefusal={(e) => <Refusal error={e} />}
        />
      )}
      {added && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/40 px-4 py-2">
          <Status tone="warn">{added.label} admitted</Status>
          <span className="text-[11px] text-faint">
            {pinnedTools(added).length} tool{pinnedTools(added).length === 1 ? "" : "s"} pinned
          </span>
          {added.pin && <DigestChip digest={added.pin.digest} label="Pin" />}
          <span className="text-[11px] text-faint">and pending: nothing attaches to a run until the pin is approved{twoPerson ? " by someone other than you" : ""}.</span>
          <span className="grow" />
          <Button size="sm" variant="solid" tone="neutral" onClick={() => setAdded(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {error && !QUIET && <p className="border-b border-line px-4 py-2.5 text-[11.5px] text-err">{error}</p>}
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
        <p className="px-4 py-3 text-[11.5px] text-faint">
          No tool server is registered. A team&rsquo;s own tools reach agents by registering the MCP server that serves them; its tools become available to agents once the pin is approved.
        </p>
      )}
    </div>
  );
}
