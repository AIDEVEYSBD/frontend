"use client";

import { IapAccess } from "./iap-access";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Mono, Status, Tag, type Tone } from "./ui";
import { Dialog } from "./overlays";
import { PageHeader } from "./section";
import { NotConnected, NotConnectedNote, useDoor } from "./pending";
import { Card, ago } from "./identity-shared";
import { whenFull } from "./dataset-parts";
import { until } from "./sessions-parts";
import { ServerState, UPSTREAM_NOT_BUILT, subjectKind } from "./authorization-parts";
import { AddAuthServerDialog } from "./authorization-add";
import { useSession } from "@/lib/use-session";
import { ask, type Answer, type AuthServer, type AuthServerList, type Door } from "@/lib/api/pending";

/**
 * Authorization servers: the outside issuers this deployment trusts.
 *
 * Console sign-in is who signs people in to this console, read from the
 * session door (`GET /api/auth/session`), with the signed-in person as the
 * example of what a sign-in yields. Workloads are the issuers whose signed
 * tokens a service signs in with (`GET /api/authorization-servers`). Upstream
 * trust (a per-person token for a tool) is not built: the platform refuses to
 * add one with 409 and `not_built: "upstream"`, and its card says so. No row
 * is ever made up.
 */

type Notice = { tone: "ok" | "err"; text: string } | { door: Door };

function Fact({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line py-2 text-[12px] last:border-0">
      <dt className="w-[150px] shrink-0 text-faint">{k}</dt>
      <dd className="flex min-w-0 grow flex-col gap-0.5 break-words text-fg">{children}</dd>
    </div>
  );
}

const none = (text = "none") => <span className="text-faint">{text}</span>;

/* ═══════════════════ console sign-in ═══════════════════ */

/** How people come in: Google Identity-Aware Proxy is the only way, and the session door says so on every answer (`via: "iap"`). */
const IAP_METHOD: { name: string; tone: Tone; how: string } = {
  name: "Google Identity-Aware Proxy",
  tone: "ok",
  how: "Google's proxy stands in front of the console and signs each person in with their Google account. Every request carries the proxy's signed statement of who the person is; the platform's service checks it against Google's published keys on every request and gives the person the roles this deployment maps them to.",
};

function ConsoleSignIn({ now }: { now: number }) {
  const { session: me, loaded } = useSession();
  const method = me ? IAP_METHOD : null;

  return (
    <Card title="Console sign-in" meta={method ? <Status tone={method.tone}>{method.name}</Status> : undefined}>
      <p className="border-b border-line px-4 py-2.5 text-[12px] leading-[1.55] text-dim">Who signs people in to this console. It is set where the console is deployed, so it is shown here and not changed here.</p>
      {!loaded && <p className="px-4 py-3 text-[12px] text-faint">Reading the session…</p>}
      {loaded && !me && <div className="p-4">{<p className="text-[12px] text-err">The session door did not say who is signed in, so how sign-in works here is not known.</p>}</div>}
      {me && method && (
        <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="flex flex-col bg-surface">
            <span className="border-b border-line px-4 py-2 text-[11px] text-faint">How sign-in works on this deployment</span>
            <dl className="flex flex-col px-4 py-1.5">
              <Fact k="Signed in by">
                <span className="font-medium">{method.name}</span>
                <span className="text-[11.5px] leading-[1.55] text-dim">{method.how}</span>
              </Fact>
              <Fact k="Roles come from">
                <span className="text-dim">This deployment&rsquo;s own map from a person&rsquo;s email to a role, set on the platform&rsquo;s service.</span>
                <Link href="/iam" className="focusable w-fit rounded-sm text-[11.5px] text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg">
                  Open people and agents
                </Link>
              </Fact>
            </dl>
          </div>
          <div className="flex flex-col bg-surface">
            <span className="border-b border-line px-4 py-2 text-[11px] text-faint">What a sign-in yields: the session you are in now</span>
            <dl className="flex flex-col px-4 py-1.5">
              <Fact k="Name">
                <span>{me.name || none("not given")}</span>
                {me.email && <span className="text-[11px] text-faint">{me.email}</span>}
              </Fact>
              <Fact k="Subject">
                <Mono className="text-[11px] break-all text-fg">{me.sub}</Mono>
              </Fact>
              <Fact k="Roles in this app">
                <span className="flex flex-wrap gap-1">{me.appRoles.length ? me.appRoles.map((r) => <Tag key={r}>{r}</Tag>) : <Tag tone="warn">none</Tag>}</span>
              </Fact>
              {me.roles.length > 0 && <Fact k="Directory roles">{me.roles.join(", ")}</Fact>}
              {me.groups && me.groups.length > 0 && <Fact k="Groups">{me.groups.join(", ")}</Fact>}
              <Fact k="May">
                <span className="flex flex-wrap gap-1">{me.permissions.length ? me.permissions.map((p) => <Tag key={p}>{p}</Tag>) : none("nothing")}</span>
              </Fact>
              {me.expiresAt && (
                <Fact k="Session ends">
                  <span className="tnum">{whenFull(me.expiresAt)}</span>
                  <span className="text-[11px] text-faint">{until(me.expiresAt, now)}</span>
                </Fact>
              )}
            </dl>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ═══════════════════ the two lists ═══════════════════ */

const th = "px-3 py-2 text-[10.5px] font-medium whitespace-nowrap text-faint";

function NameCell({ s }: { s: AuthServer }) {
  return (
    <td className="max-w-[240px] py-2.5 pr-3 pl-4">
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[12.5px] font-medium text-fg">{s.name || s.id}</span>
        <span className="truncate font-mono text-[10.5px] text-faint">{s.id}</span>
      </span>
    </td>
  );
}

function StateCell({ s, now }: { s: AuthServer; now: number }) {
  return (
    <td className="px-3 py-2.5 whitespace-nowrap">
      <span className="flex flex-col gap-0.5">
        <ServerState state={s.state} />
        {s.checked_at && (
          <span className="text-[10.5px] text-faint" title={whenFull(s.checked_at)}>
            reached {ago(s.checked_at, now)}
          </span>
        )}
      </span>
    </td>
  );
}

function RemoveCell({ onRemove }: { onRemove: () => void }) {
  return (
    <td className="py-2 pr-4 pl-3 text-right whitespace-nowrap">
      <Button size="sm" variant="solid" tone="err" permission="iam" onClick={onRemove}>
        Remove
      </Button>
    </td>
  );
}

/** What a list shows in place of rows: reading, not connected, a failed read, or nothing yet. */
function ListState({ answer, count, pendingText, emptyText }: { answer: Answer<AuthServerList> | null; count: number; pendingText: string; emptyText: string }) {
  if (answer === null) return <p className="px-4 py-3 text-[12px] text-faint">Reading the authorization servers…</p>;
  if (answer.state === "pending")
    return (
      <div className="p-4">
        <NotConnected door={answer.door} compact>
          {pendingText}
        </NotConnected>
      </div>
    );
  if (answer.state === "error") return <div className="p-4">{<p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">The authorization servers could not be read: {answer.message}</p>}</div>;
  if (count === 0) return <p className="px-4 py-4 text-[12px] text-faint">{emptyText}</p>;
  return null;
}

export function AuthorizationView() {
  const { answer, reload } = useDoor<AuthServerList>("authServers");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AuthServer | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now] = useState(() => Date.now());

  const connected = answer?.state === "ok";
  const pending = answer?.state === "pending";
  const all = useMemo(() => (answer?.state === "ok" && Array.isArray(answer.data?.servers) ? answer.data.servers : []), [answer]);
  const workload = all.filter((s) => s.purpose === "workload");

  const remove = async () => {
    if (!removing || busy) return;
    setBusy(true);
    const a = await ask<unknown>("authServerRemove", { params: { id: removing.id } });
    setBusy(false);
    const was = removing;
    setRemoving(null);
    if (a.state === "pending") return setNotice({ door: a.door });
    if (a.state === "error") return setNotice({ tone: "err", text: a.message });
    setNotice({ tone: "ok", text: was.purpose === "workload" ? `Trust in ${was.name || was.id} was withdrawn. No workload can sign in with a token from it.` : `${was.name || was.id} was removed.` });
    reload();
  };

  const noticeText: ReactNode = notice ? "door" in notice ? <NotConnectedNote door={notice.door} /> : notice.text : null;
  const count = (n: number) => (connected ? n.toLocaleString("en-GB") : undefined);

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <PageHeader
        title="Authorization servers"
        action={
          <span title={pending ? "Not built yet: the platform answers 501" : undefined}>
            <Button variant="solid" tone="ink" permission="iam" disabled={!connected} onClick={() => setAdding(true)}>
              Add an authorization server
            </Button>
          </span>
        }
      >
        The outside issuers this deployment trusts: who signs people in to the console, and whose signed tokens a service may sign in with. Upstream trust, a per-person token for a tool, is not built.
      </PageHeader>

      {notice && (
        <div className="relative flex flex-wrap items-center gap-3 overflow-hidden rounded-lg border border-line bg-surface py-2.5 pr-3 pl-4 elev-1">
          {"tone" in notice && (
            <>
              <span className={`absolute inset-y-0 left-0 w-[3px] ${notice.tone === "err" ? "bg-err" : "bg-ok"}`} />
              <Status tone={notice.tone}>{notice.tone === "err" ? "Refused" : "Done"}</Status>
            </>
          )}
          <span className="min-w-0 text-[12.5px] leading-[1.5] text-fg">{noticeText}</span>
          <span className="grow" />
          <Button size="sm" variant="solid" tone="neutral" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <ConsoleSignIn now={now} />
      <IapAccess />

      {/* ── upstream services: not built ── */}
      <Card title="Upstream services" meta="not built">
        <div className="p-4">
          <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-line-strong bg-surface px-4 py-3" data-not-built="upstream">
            <span className="flex items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-[2px] bg-faint" />
              <span className="text-[13px] font-semibold text-fg">Upstream trust is not built</span>
            </span>
            <p className="max-w-[86ch] text-[12.5px] leading-[1.55] text-dim">
              An upstream issuer would give a per-person token for a tool, so a tool server is called as the person and not with a shared key. {UPSTREAM_NOT_BUILT}
            </p>
          </div>
        </div>
      </Card>

      {/* ── workloads ── */}
      <Card title="Workloads" meta={count(workload.length)}>
        <p className="border-b border-line px-4 py-2.5 text-[12px] leading-[1.55] text-dim">
          Issuers whose signed tokens a service signs in with: the token is sent on every request and checked there, so no long-lived key is stored for the service. A Kubernetes service account issuer is one.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-line">
                <th className={`${th} pl-4`}>Name</th>
                <th className={th}>Issuer address</th>
                <th className={th}>Admitted subjects</th>
                <th className={`${th} text-right`} title="Services from this issuer seen in the last 30 minutes">Connected now</th>
                <th className={th}>State</th>
                <th className="py-2 pr-4 pl-3" />
              </tr>
            </thead>
            <tbody>
              {workload.map((s) => (
                <tr key={s.id} className="border-b border-line align-top last:border-0">
                  <NameCell s={s} />
                  <td className="max-w-[320px] px-3 py-2.5">
                    <Mono className="text-[11px] break-all text-fg">{s.issuer}</Mono>
                  </td>
                  <td className="max-w-[380px] px-3 py-2.5">
                    {s.subjects?.length ? (
                      <span className="flex flex-wrap gap-1">
                        {s.subjects.map((x) => (
                          <span key={x} className="inline-flex max-w-full items-center gap-1.5 rounded-[3px] border border-line bg-raise px-1.5 py-px" title={subjectKind(x) === "prefix" ? `Every subject that starts with ${x.slice(0, -1)}` : "This subject exactly"}>
                            <span className="font-mono text-[10.5px] break-all text-fg">{x}</span>
                            <span className="text-[10px] text-faint">{subjectKind(x)}</span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-warn">none: no workload from it is admitted</span>
                    )}
                  </td>
                  <td className="tnum px-3 py-2.5 text-right whitespace-nowrap">{s.sessions === undefined ? <span className="text-ghost">not recorded</span> : s.sessions.toLocaleString("en-GB")}</td>
                  <StateCell s={s} now={now} />
                  <RemoveCell onRemove={() => setRemoving(s)} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ListState
          answer={answer}
          count={workload.length}
          pendingText="The issuers whose signed tokens a service signs in with: each with its address, the subjects admitted from it (exact, or a prefix ending in *), how many of its services are connected and its state."
          emptyText="No workload issuer is trusted yet."
        />
      </Card>

      {adding && (
        <AddAuthServerDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            reload();
          }}
        />
      )}

      {removing && (
        <Dialog
          modal
          tone="err"
          cancel="Cancel"
          confirm={removing.purpose === "workload" ? "Withdraw trust" : "Remove"}
          title={removing.purpose === "workload" ? `Withdraw trust in ${removing.name || removing.id}?` : `Remove ${removing.name || removing.id}?`}
          loading={busy}
          onConfirm={remove}
          onClose={() => !busy && setRemoving(null)}
        >
          <span className="flex flex-col gap-2">
            {removing.purpose === "workload" ? (
              <>
                <span>
                  Withdrawing trust in an issuer stops every workload from it: the next token from <span className="font-mono text-[11.5px] break-all text-fg">{removing.issuer}</span> is refused, and its services leave
                  the register.
                </span>
                {removing.sessions !== undefined && (
                  <span>{removing.sessions === 0 ? "None of its services is connected now." : removing.sessions === 1 ? "The one service connected now is cut off." : `The ${removing.sessions.toLocaleString("en-GB")} services connected now are cut off.`}</span>
                )}
                {Boolean(removing.subjects?.length) && (
                  <span className="flex flex-col gap-1">
                    <span>Subjects admitted from it today:</span>
                    <span className="flex max-h-[120px] flex-col gap-0.5 overflow-y-auto rounded-sm border border-line bg-canvas px-2 py-1.5">
                      {removing.subjects!.map((x) => (
                        <span key={x} className="font-mono text-[11px] break-all text-fg">
                          {x}
                        </span>
                      ))}
                    </span>
                  </span>
                )}
              </>
            ) : (
              <>
                <span>
                  This deployment stops trusting <span className="font-mono text-[11.5px] break-all text-fg">{removing.issuer}</span> for per-person tokens.
                </span>
                {removing.tool_servers === undefined ? (
                  <span>The record does not say which tool servers use it.</span>
                ) : removing.tool_servers.length === 0 ? (
                  <span>No tool server uses it.</span>
                ) : (
                  <span className="flex flex-col gap-1">
                    <span>{removing.tool_servers.length === 1 ? "One tool server gets its tokens from it and can no longer be called as the person:" : `${removing.tool_servers.length.toLocaleString("en-GB")} tool servers get their tokens from it and can no longer be called as the person:`}</span>
                    <span className="flex max-h-[120px] flex-col gap-0.5 overflow-y-auto rounded-sm border border-line bg-canvas px-2 py-1.5">
                      {removing.tool_servers.map((t) => (
                        <span key={t.id} className="text-[11.5px] text-fg">
                          {t.name || t.id}
                        </span>
                      ))}
                    </span>
                  </span>
                )}
              </>
            )}
          </span>
        </Dialog>
      )}
    </div>
  );
}
