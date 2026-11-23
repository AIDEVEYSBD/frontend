"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { Button, Mono, Status, Tag, type Tone } from "./ui";
import { ago, initialsOf } from "./identity-shared";
import { whenFull } from "./dataset-parts";
import type { Session, SessionKind, SessionState } from "@/lib/api/pending";

/**
 * What the sessions list, its side panel and its confirm dialogs share: how
 * a session's kind, state, client and times are worded, and what ending one
 * stops. Nothing here holds a record.
 */

export const KIND_WORD: Record<SessionKind, { one: string; many: string; glyph: string }> = {
  person: { one: "Person", many: "People", glyph: "P" },
  agent: { one: "Agent", many: "Agents", glyph: "A" },
  tool_server: { one: "Tool server", many: "Tool servers", glyph: "T" },
};
export const kindWord = (k: string): string => KIND_WORD[k as SessionKind]?.one ?? k.replace(/_/g, " ");

export const STATE_TONE: Record<SessionState, Tone> = { active: "ok", idle: "warn", expired: "neutral", revoked: "err" };

/** A session in use now: seen within the platform's live window. */
export const isLive = (s: Session): boolean => s.state === "active" || s.state === "idle";

/**
 * A session that can be ended: any not already ended. Ending acts on the
 * caller, not on a cookie, so a person or a key not seen lately ("expired")
 * still has something to stop: the person can come back, the key still works.
 * An attached agent's own key (client `sdk`) is not ended here: the platform
 * revokes it by detaching the agent, or refuses it while the agent is blocked,
 * both on Configuration, Third-party agents. A run's use of a tool server
 * (`tool_server`) is not a connection the platform holds: there is nothing
 * to end, and the platform refuses it (409); removing the server from the
 * registry stops calls to it.
 */
export const isEndable = (s: Session): boolean => s.state !== "revoked" && !attachedKey(s) && s.kind !== "tool_server";

/** An attached agent's session: its own key at the SDK, gateway and broker doors. */
export const attachedKey = (s: Session): boolean => s.kind === "agent" && s.client.kind === "sdk";

const CLIENT_WORD: Record<string, string> = {
  browser: "Browser",
  api_key: "API key",
  workload: "Workload sign-in",
  sdk: "SDK",
  mcp_client: "Tool client",
  platform: "The platform",
};
/** A client's kind as the page names it; a word the page does not know is shown as it was sent. */
export const clientWord = (k: string): string => CLIENT_WORD[k] ?? k.replace(/_/g, " ");

const TARGET_WORD: Record<string, string> = { console: "Console", gateway: "Model gateway", tool_server: "Tool server" };
export const targetWord = (k: string): string => TARGET_WORD[k] ?? k.replace(/_/g, " ");

/** Whether a name already says what its kind would: the second line is then left out. */
export const sameWord = (name: string, word: string): boolean => name.trim().toLowerCase().replace(/^the /, "") === word.trim().toLowerCase().replace(/^the /, "");

/** `in 12m`, `in 3h`, `in 5d` for a time ahead; `3h ago` for one behind; "" when there is no time to tell. */
export function until(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  if (t <= now) return ago(iso, now);
  const mins = Math.round((t - now) / 60000);
  if (mins < 1) return "in under a minute";
  if (mins < 60) return `in ${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

/** Whether the session is the tool-server kind held for an agent, or an agent's own: either way an owner answers for it. */
export const forAgent = (s: Session): boolean => s.kind === "agent" || (s.kind === "tool_server" && s.principal.kind === "agent");

/** The second line under a name: a person's email, an agent's owner. */
export function whoLine(s: Session): string {
  if (forAgent(s)) return s.owner ? `owned by ${s.owner.name}` : "no owner recorded";
  return s.principal.email || s.principal.id;
}

/** What a session is connected to, as it reads inside a sentence. */
export function targetPhrase(s: Session): string {
  if (s.target.kind === "console") return "the console";
  if (s.target.kind === "gateway") return "the model gateway";
  return s.target.name || s.target.id;
}

/** What ending this one session does, in the platform's terms: ending stops the caller from its next request. */
export function consequence(s: Session): string {
  const who = s.principal.name || s.principal.id;
  if (s.kind === "person")
    return `${who} is held out of ${targetPhrase(s)}: every request of theirs is refused until an administrator lets them back. This service cannot end their Google sign-in, and their API keys keep working until revoked.`;
  if (s.kind === "agent" && s.client.kind === "api_key") return `The API key ${who} is revoked: its next request is refused, and a revoked key cannot be restored. Mint a new key to replace it.`;
  if (s.kind === "agent" && s.client.kind === "workload")
    return `Every token issued to ${who} until now is refused. A token its issuer issues later signs it in again; to keep it out, remove its subject from the issuer.`;
  if (attachedKey(s))
    return `${who} is an attached agent: its session is not ended here. Block it to refuse its key until it is unblocked, or detach it to revoke its key and stop its runs in flight, both on Configuration, Third-party agents.`;
  if (s.kind === "tool_server")
    return `This is a run's record of its calls to ${s.target.name || "a tool server"}: nothing is held open, so there is no session to end. Remove the server from the registry (Configuration, Tools) to stop calls to it.`;
  return `${who} is stopped from its next request.`;
}

/** What ending several does: one sentence for each kind of caller among them. */
export function consequences(rows: Session[]): string[] {
  const out: string[] = [];
  if (rows.some((s) => s.kind === "person")) out.push("People are held out until an administrator lets them back; their API keys keep working until revoked.");
  if (rows.some((s) => s.kind === "agent" && s.client.kind === "api_key")) out.push("API keys are revoked, for good.");
  if (rows.some((s) => s.kind === "agent" && s.client.kind === "workload")) out.push("Workload services have every token issued to them until now refused; a later token signs them in again.");
  return out;
}

/** The mark beside a name: a person's initials on the ink, a letter for an agent or a tool server connection. */
export function SessionGlyph({ session: s, size = "size-6 text-[10px]" }: { session: Session; size?: string }) {
  if (s.kind === "person") return <span className={`grid shrink-0 place-items-center rounded-full bg-ink font-semibold text-on-ink ${size}`}>{initialsOf(s.principal.name || s.principal.email || s.principal.id)}</span>;
  return (
    <span className={`grid shrink-0 place-items-center rounded-md font-semibold text-on-solid ${size}`} style={{ background: s.kind === "agent" ? "var(--t-c2)" : "var(--t-c7)" }}>
      {KIND_WORD[s.kind]?.glyph ?? "?"}
    </span>
  );
}

export function SessionState({ state }: { state: string }) {
  return <Status tone={STATE_TONE[state as SessionState] ?? "neutral"}>{state}</Status>;
}

/** The names a confirm dialog lists: who, what kind, and what each is connected to. */
export function Affected({ rows }: { rows: Session[] }) {
  return (
    <span className="flex max-h-[168px] flex-col gap-1 overflow-y-auto rounded-sm border border-line bg-canvas px-2 py-1.5">
      {rows.map((s) => (
        <span key={s.id} className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] leading-[1.5]">
          <span className="font-medium text-fg">{s.principal.name || s.principal.id}</span>
          <span className="text-faint">
            {kindWord(s.kind).toLowerCase()}, {s.client.name} to {targetPhrase(s)}
          </span>
        </span>
      ))}
    </span>
  );
}

function Fact({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line py-2 text-[12px] last:border-0">
      <dt className="w-[120px] shrink-0 text-faint">{k}</dt>
      <dd className="flex min-w-0 grow flex-col gap-0.5 break-words text-fg">{children}</dd>
    </div>
  );
}

const sub = "text-[11px] text-faint";
const link = "focusable w-fit rounded-sm text-[11.5px] text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg";

/**
 * One session, in a panel at the side of the list: the full record, what it
 * did lately when the door keeps that, and the way to end it.
 */
export function SessionPanel({
  session: s,
  now,
  mine,
  issuedToClient,
  locked,
  note,
  onClose,
  onEnd,
  onEndClient,
  notBuilt = [],
}: {
  session: Session;
  now: number;
  /** The session is the signed-in person's own. */
  mine: boolean;
  /** Live sessions issued to the same client registration, this one among them; empty when it has none. */
  issuedToClient: Session[];
  /** A confirm dialog is open over the panel: Escape and the scrim are its to answer. */
  locked: boolean;
  /** What the last action on this session came to, when it did not end it. */
  note?: ReactNode;
  onClose: () => void;
  onEnd: () => void;
  onEndClient: () => void;
  /** The list's `not_built`: a field named there reads "not built", never "none". */
  notBuilt?: string[];
}) {
  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, onClose]);

  const who = s.principal.name || s.principal.id;
  const live = isLive(s);
  const endable = isEndable(s);
  const activity = s.activity;
  const activityUnbuilt = notBuilt.some((f) => f === "activity" || f.endsWith(".activity"));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-canvas/60" onClick={locked ? undefined : onClose}>
      <aside role="dialog" aria-modal="true" aria-label={`Session of ${who}`} onClick={(e) => e.stopPropagation()} className="flex h-full w-[min(520px,100%)] flex-col border-l border-line bg-surface elev-3 af-pop">
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
          <SessionGlyph session={s} size="size-9 text-[12.5px]" />
          <span className="flex min-w-0 grow flex-col gap-1">
            <span className="text-[14px] leading-[1.3] font-semibold tracking-[-0.005em] break-words">{who}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <Tag>{kindWord(s.kind)}</Tag>
              <SessionState state={s.state} />
              {mine && <Tag>you</Tag>}
            </span>
          </span>
          <span className="shrink-0">
            <Button size="sm" variant="solid" tone="err" disabled={locked} onClick={onClose}>
              Close
            </Button>
          </span>
        </header>

        <div className="min-h-0 grow overflow-y-auto">
          <dl className="flex flex-col px-4 py-1.5">
            <Fact k={s.kind === "tool_server" ? "Held for" : "Who"}>
              <span>{who}</span>
              {s.principal.email && <span className={sub}>{s.principal.email}</span>}
              <Mono className="text-[10.5px] break-all">{s.principal.id}</Mono>
              <Link href={`/iam?identity=${encodeURIComponent(s.principal.id)}`} className={link}>
                Open this identity
              </Link>
            </Fact>
            {forAgent(s) && (
              <Fact k="Answers for it">
                {s.owner ? (
                  <>
                    <span>{s.owner.name}</span>
                    {(s.owner.email || s.owner.team) && <span className={sub}>{[s.owner.email, s.owner.team].filter(Boolean).join(" · ")}</span>}
                  </>
                ) : (
                  <span className="text-warn">No owner is recorded for this agent.</span>
                )}
              </Fact>
            )}
            <Fact k="Connected with">
              <span>{s.client.name}</span>
              {!sameWord(s.client.name, clientWord(s.client.kind)) && <span className={sub}>{clientWord(s.client.kind)}</span>}
            </Fact>
            {s.client.registration && (
              <Fact k="Client registration">
                <Mono className="text-[11px] break-all text-fg">{s.client.registration}</Mono>
                <span className={sub}>
                  {issuedToClient.length === 1 ? "This is the only live session issued to it." : `${issuedToClient.length.toLocaleString("en-GB")} live sessions are issued to it.`} Ending the registration ends every one of them.
                </span>
              </Fact>
            )}
            <Fact k="Connected to">
              <span>{s.target.name}</span>
              {!sameWord(s.target.name, targetWord(s.target.kind)) && <span className={sub}>{targetWord(s.target.kind)}</span>}
              {s.target.kind === "tool_server" && (
                <Link href="/configuration#tools" className={link}>
                  Open tool servers
                </Link>
              )}
            </Fact>
            <Fact k="Started">
              <span className="tnum">{whenFull(s.started_at)}</span>
              <span className={sub}>{ago(s.started_at, now)}</span>
            </Fact>
            <Fact k="Last active">
              {s.last_seen_at ? (
                <>
                  <span className="tnum">{whenFull(s.last_seen_at)}</span>
                  <span className={sub}>{ago(s.last_seen_at, now)}</span>
                </>
              ) : (
                <span className="text-ghost">not recorded</span>
              )}
            </Fact>
            <Fact k={live ? "Ends" : s.state === "expired" ? "Expired" : "Was due to end"}>
              {s.expires_at ? (
                <>
                  <span className="tnum">{whenFull(s.expires_at)}</span>
                  <span className={sub}>{live ? `must be renewed ${until(s.expires_at, now)}` : until(s.expires_at, now)}</span>
                </>
              ) : (
                <span className="text-ghost">no end is recorded</span>
              )}
            </Fact>
            <Fact k="Issued by">
              <span>{s.issued_by?.name || <span className="text-ghost">not recorded</span>}</span>
              {s.issued_by?.server && (
                <Link href="/authorization" className={link}>
                  Open authorization servers
                </Link>
              )}
            </Fact>
            {s.ip && (
              <Fact k="Address">
                <Mono className="text-[11px] text-fg">{s.ip}</Mono>
              </Fact>
            )}
            <Fact k="Session">
              <Mono className="text-[11px] break-all text-fg">{s.id}</Mono>
            </Fact>
          </dl>

          <div className="flex flex-col border-t border-line">
            <div className="flex items-center gap-2 border-b border-line bg-raise/55 px-4 py-2">
              <span className="text-[12px] font-semibold">Recent activity</span>
              {activity && <span className="tnum text-[11px] text-faint">{activity.length.toLocaleString("en-GB")}</span>}
            </div>
            {activity === undefined && (
              <p className="px-4 py-3 text-[12px] text-faint">{activityUnbuilt ? "Not built: the platform keeps no record of what a session did. The audit trail on People and agents holds every change a caller made." : "The record carries no activity for this session."}</p>
            )}
            {activity && activity.length === 0 && <p className="px-4 py-3 text-[12px] text-faint">Nothing has been recorded on this session yet.</p>}
            {(activity ?? []).map((a, i) => (
              <div key={`${a.at}:${i}`} className="flex items-baseline gap-3 border-b border-line px-4 py-2 last:border-0">
                <span className="tnum w-[58px] shrink-0 text-[11px] text-faint" title={whenFull(a.at)}>
                  {ago(a.at, now)}
                </span>
                <span className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="text-[12px] break-words text-fg">{a.action}</span>
                  {a.detail && <span className="font-mono text-[10.5px] break-all text-faint">{a.detail}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>

        <footer className="flex shrink-0 flex-col gap-2 border-t border-line px-4 py-3">
          <span className="text-[11.5px] leading-[1.5] text-faint">
            {note ??
              (s.state === "revoked"
                ? "Ended by an administrator, and not seen since. It stays here as a record."
                : mine
                  ? "This is your own session. Nobody ends their own; another administrator can."
                  : `${live || attachedKey(s) ? "" : "Not seen in the last 30 minutes; ending it still acts. "}${consequence(s)}`)}
          </span>
          {endable && !mine && (
            <span className="flex flex-wrap items-center justify-end gap-2">
              {s.client.registration && (
                <Button size="sm" variant="solid" tone="err" permission="iam" onClick={onEndClient}>
                  End the client&rsquo;s registration
                </Button>
              )}
              <Button size="sm" variant="solid" tone="err" permission="iam" onClick={onEnd}>
                End session
              </Button>
            </span>
          )}
        </footer>
      </aside>
    </div>
  );
}
