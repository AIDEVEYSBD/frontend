"use client";

import { useEffect, useState } from "react";
import { Button, Status, Tag } from "./ui";
import { Card } from "./identity-shared";
import { roleLabel } from "@/lib/permissions";
import { ask, refusalField, type Answer } from "@/lib/api/pending";
import { AnswerFailure } from "./pending";

/** One entry on IAP's access list, as GET /api/auth/access answers it. */
export interface IapPrincipal {
  /** As IAM writes it: user:a@b.com, group:g@b.com, domain:b.com, serviceAccount:… */
  member: string;
  kind: "person" | "group" | "domain" | "service_account" | "other";
  name: string;
  /** Where the grant sits. */
  level: "service" | "kind" | "project";
  /** The console role the mapping gives this entry; null when it gives none, and for a group, where it is decided per person at sign-in. */
  role: string | null;
  /** True when the role is the default because the mapping names no role for this entry. */
  defaulted: boolean;
  /** An IAM condition on the grant, in its own words, when there is one. */
  condition?: string;
}

/** One level IAP keeps an access list at, and whether it was read; `reason` says why not. */
export interface IapLevel {
  level: IapPrincipal["level"];
  label: string;
  read: boolean;
  reason?: string;
}

/** What the service account needs to read the access lists, as the platform says when it cannot. */
interface Needs {
  role?: string;
  permissions?: string[];
  note?: string;
}

/** What GET /api/auth/access answers. */
export interface IapAccessAnswer {
  /** IAP sign-in is on for this deployment. */
  enabled: boolean;
  /** The access lists were read. */
  readable: boolean;
  /** The IAP resource this console sits behind, as IAP names it. */
  resource: string;
  /** Which levels answered; a level that did not says why. */
  levels: IapLevel[];
  principals: IapPrincipal[];
  /** Entries the role mapping names that IAP does not let through at any level read. */
  mappedOnly: string[];
  checkedAt: string;
}

/**
 * Who Google IAP lets through to this console (GET /api/auth/access).
 *
 * Read from IAP's own access lists, so it is the people, groups and domains
 * as they were granted, each beside the console role the deployment's
 * mapping gives it. A group or a domain is one row: its members are the
 * directory's to list. Where the platform does not build the read, or the
 * read fails, the card says so; it is never simply left out.
 */

const KIND: Record<IapPrincipal["kind"], string> = { person: "Person", group: "Group", domain: "Domain", service_account: "Service account", other: "Other" };

export function IapAccess() {
  const [answer, setAnswer] = useState<IapAccessAnswer | null>(null);
  const [failed, setFailed] = useState<Answer<unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    ask<IapAccessAnswer>("authAccess", { query: tick ? { fresh: 1 } : {} })
      .then((a) => {
        if (!live) return;
        if (a.state === "ok" && a.data && Array.isArray(a.data.principals)) {
          setAnswer(a.data);
          setFailed(null);
        } else setFailed(a.state === "ok" ? { state: "error", message: "GET /api/auth/access answered with something that is not the access list" } : a);
      })
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [tick]);

  if (failed && !answer) {
    // The platform's own reason, and what its service account would need: never read as "nobody".
    const needs = refusalField(failed, "needs") as Needs | undefined;
    const levels = (refusalField(failed, "levels") as IapLevel[] | undefined) ?? [];
    if (failed.state === "error" && needs && typeof needs === "object") {
      return (
        <Card title="Who can open this console" meta={<span className="text-err">not read</span>}>
          <div className="flex flex-col gap-2.5 px-4 py-3">
            <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err" role="alert">
              The IAP access list could not be read: {failed.message}
            </p>
            {levels.length > 0 && <LevelsNotRead levels={levels} />}
            <dl className="flex flex-col gap-1 text-[12px] leading-[1.55]">
              {needs.role && (
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <dt className="text-faint">The service account needs</dt>
                  <dd className="font-mono text-[11.5px] text-fg">{needs.role}</dd>
                  {needs.permissions?.length ? (
                    <dd className="text-dim">
                      or a narrower role with <span className="font-mono text-[11px] text-fg">{needs.permissions.join(", ")}</span>
                    </dd>
                  ) : null}
                </div>
              )}
            </dl>
          </div>
        </Card>
      );
    }
    return (
      <Card title="Who can open this console">
        <div className="px-4 py-3">
          <AnswerFailure answer={failed} what="The console's access list could not be read" />
        </div>
      </Card>
    );
  }
  if (!answer) return null;
  if (!answer.enabled)
    return (
      <Card title="Who can open this console">
        <p className="px-4 py-3 text-[12.5px] leading-[1.55] text-dim">IAP sign-in is not set up on this deployment.</p>
      </Card>
    );
  if (!answer.readable) {
    return (
      <Card title="Who can open this console">
        <p className="px-4 py-3 text-[12.5px] leading-[1.55] text-dim">The IAP access list could not be read: the service account lacks permission.</p>
      </Card>
    );
  }

  const rows = answer.principals;
  const unread = answer.levels.filter((l) => !l.read);
  return (
    <Card
      id="iap-access"
      title="Who can open this console"
      meta={`${rows.length} ${rows.length === 1 ? "entry" : "entries"} on IAP's access list`}
      action={
        <Button size="sm" variant="solid" tone="neutral" loading={busy} onClick={() => { setBusy(true); setTick((t) => t + 1); }}>
          Read again
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-[12.5px] text-dim">Nobody is on the access list at the levels read.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] text-faint">
                <th className="px-4 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Role in this console</th>
                <th className="px-3 py-2 font-medium">Granted on</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.member} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11.5px] text-fg">{p.name}</span>
                    {p.condition && <span className="mt-0.5 block text-[11px] text-faint">only when: {p.condition}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-dim">{KIND[p.kind]}</td>
                  <td className="px-3 py-2.5">
                    {p.role ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Tag>{p.role.split(", ").map(roleLabel).join(", ")}</Tag>
                        {p.defaulted && <span className="text-[11px] text-faint">by default; the role mapping does not name {p.kind === "domain" ? "this domain" : "this person"}</span>}
                      </span>
                    ) : p.kind === "group" ? (
                      <span className="text-[11.5px] text-faint">set per member at sign-in</span>
                    ) : p.kind === "person" || p.kind === "domain" ? (
                      <span className="text-[11.5px] text-faint">none: let in by Google, refused by the console</span>
                    ) : (
                      <span className="text-[11.5px] text-faint">does not sign in to the console</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-dim">{answer.levels.find((l) => l.level === p.level)?.label ?? p.level}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(answer.mappedOnly.length > 0 || unread.length > 0) && (
        <div className="flex flex-col gap-1.5 border-t border-line px-4 py-2.5 text-[11.5px] leading-[1.55] text-faint">
          {answer.mappedOnly.length > 0 && (
            <span>
              In the role mapping, not on the access list:{" "}
              <span className="font-mono text-[11px] text-dim">{answer.mappedOnly.join(", ")}</span>
            </span>
          )}
          {unread.length > 0 && <LevelsNotRead levels={unread} />}
        </div>
      )}
    </Card>
  );
}

/** The levels whose access list could not be read, each with the platform's reason. A grant made at one of them would also let someone in. */
function LevelsNotRead({ levels }: { levels: IapLevel[] }) {
  const unread = levels.filter((l) => !l.read);
  if (!unread.length) return null;
  return (
    <span className="flex flex-col gap-1">
      <span className="text-[11.5px] text-faint">Not read (a grant here would also let someone in):</span>
      {unread.map((l) => (
        <span key={l.level} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11.5px] leading-[1.5]">
          <Status tone="err">Not read</Status>
          <span className="text-fg">{l.label}</span>
          {l.reason && <span className="min-w-0 basis-full font-mono text-[10.5px] break-all text-dim sm:basis-auto">{l.reason}</span>}
        </span>
      ))}
    </span>
  );
}
