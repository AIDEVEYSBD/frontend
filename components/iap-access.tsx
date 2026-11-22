"use client";

import { useEffect, useState } from "react";
import { Button, Status, Tag } from "./ui";
import { Card } from "./identity-shared";
import { roleLabel } from "@/lib/permissions";
import { ask, type Answer } from "@/lib/api/pending";
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

/** What GET /api/auth/access answers. */
export interface IapAccessAnswer {
  /** IAP sign-in is on for this deployment. */
  enabled: boolean;
  /** The access lists were read. */
  readable: boolean;
  /** The IAP resource this console sits behind, as IAP names it. */
  resource: string;
  /** Which levels answered. */
  levels: { level: IapPrincipal["level"]; label: string; read: boolean }[];
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

  if (failed && !answer)
    return (
      <Card title="Who can open this console">
        <div className="px-4 py-3">
          <AnswerFailure answer={failed} what="The console's access list could not be read" />
        </div>
      </Card>
    );
  if (!answer || !answer.enabled) return null;
  if (!answer.readable) {
    return (
      <Card title="Who can open this console">
        <p className="px-4 py-3 text-[12.5px] leading-[1.55] text-dim">
          Sign-in is through Google Identity-Aware Proxy, but its access list could not be read: this server&rsquo;s service account needs permission to read the IAP policy
          of the service.
        </p>
      </Card>
    );
  }

  const rows = answer.principals;
  const unread = answer.levels.filter((l) => !l.read);
  return (
    <Card
      id="iap-access"
      title="Who can open this console"
      meta={`${rows.length} ${rows.length === 1 ? "entry" : "entries"} on Google Identity-Aware Proxy's access list`}
      action={
        <Button size="sm" variant="solid" tone="neutral" loading={busy} onClick={() => { setBusy(true); setTick((t) => t + 1); }}>
          Read again
        </Button>
      }
    >
      <p className="border-b border-line px-4 py-2.5 text-[12px] leading-[1.55] text-dim">
        Everyone Google lets through to this console, as granted on its access list, with the role each holds here. A group or a domain is one entry: its members are
        listed in the directory, not here.
      </p>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-[12.5px] text-dim">Nobody is on the access list at the levels read, so nobody can open the console through the proxy.</p>
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
              Named in the role mapping but not on the access list, so they cannot get in:{" "}
              <span className="font-mono text-[11px] text-dim">{answer.mappedOnly.join(", ")}</span>
            </span>
          )}
          {unread.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              <Status tone="neutral">Not read</Status>
              {unread.map((l) => l.label).join("; ")}. A grant made there would also let someone in.
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
