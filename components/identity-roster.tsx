"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Status, Tag } from "./ui";
import { ActiveFilters, Chips, FilterBar, MoreFilters, SearchBox, type Chip } from "./filters";
import {
  DAY,
  FLAGS,
  GROUPS,
  KINDS,
  KIND_META,
  KindGlyph,
  OwnerChip,
  STATUS_TONE,
  ago,
  entryName,
  groupOf,
  identityUrl,
  kindLabel,
  lastSeenOf,
  riskLabel,
  statusOf,
  type Entry,
  type Finding,
  type Group,
  type Identity,
} from "./identity-shared";

/**
 * The roster: everyone and everything that can act here, in one list.
 *
 * People the identity provider has signed in and the non-human identities
 * on the register (agents, MCP servers, keys, vault credentials) share the
 * columns that mean something for both: a name, a kind, the roles a person
 * holds or the person who answers for an identity, when it was last seen,
 * and its status. A row opens the identity's page. The filter is the page's
 * to hold, so a figure above the list can narrow it.
 */

export interface RosterFilter {
  groups: Group[];
  /** Specific non-human kinds (workflow, api_key, ...). */
  kinds: string[];
  statuses: string[];
  risks: string[];
  flags: string[];
  /** People holding one of these app roles. */
  roles: string[];
  /** People who hold one of these permissions. */
  permissions: string[];
  q: string;
}
export const NO_FILTER: RosterFilter = { groups: [], kinds: [], statuses: [], risks: [], flags: [], roles: [], permissions: [], q: "" };

/** An API key that is active and has never been used, has been idle for thirty days, or is older than ninety. */
export function keyToReview(i: Identity, now: number): boolean {
  if (i.kind !== "api_key" || i.status !== "active") return false;
  if (!i.last_used) return true;
  if (now - new Date(i.last_used).getTime() > 30 * DAY) return true;
  return Boolean(i.created_at) && now - new Date(i.created_at!).getTime() > 90 * DAY;
}

const ROSTER_FLAGS = [...FLAGS, { value: "review", label: "Credentials to review", tone: "warn" as const }];

export function hasFlag(e: Entry, flag: string, now: number, findingsOf: Map<string, Finding[]>): boolean {
  if (e.type === "person") return false;
  const i = e.identity;
  const live = i.status !== "revoked";
  switch (flag) {
    case "unowned":
      return live && !i.owner;
    case "unused":
      return live && !i.last_used && i.kind !== "workflow";
    case "stale":
      return live && Boolean(i.last_used) && now - new Date(i.last_used!).getTime() > 30 * DAY;
    case "risky":
      return i.risk === "risky" || i.risk === "destructive";
    case "blocked":
      return i.status === "blocked";
    case "findings":
      return findingsOf.has(e.key);
    case "review":
      return keyToReview(i, now);
    default:
      return true;
  }
}

type SortKey = "group" | "name" | "kind" | "last" | "status";
type Dim = "group" | "kind" | "status" | "risk" | "flag";

export function IdentityRoster({
  entries,
  findingsOf,
  now,
  loading,
  filter,
  onFilter,
  meSub,
  onOpen,
  onAssignOwner,
  ownerStoreDown,
  unread = false,
}: {
  entries: Entry[];
  findingsOf: Map<string, Finding[]>;
  now: number;
  /** Neither door has answered yet. */
  loading: boolean;
  filter: RosterFilter;
  onFilter: (f: RosterFilter) => void;
  meSub: string;
  onOpen: (key: string) => void;
  onAssignOwner: (key: string) => void;
  /** The register's own table (owners) cannot be written on this deployment. */
  ownerStoreDown: boolean;
  /** A quiet console (lib/quiet.ts) with neither door read: the roster is drawn empty, with no counts. */
  unread?: boolean;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "group", dir: 1 });

  const matches = (e: Entry, skip?: Dim): boolean => {
    const f = filter;
    if (skip !== "group" && f.groups.length && !f.groups.includes(groupOf(e))) return false;
    if (skip !== "kind" && f.kinds.length && !(e.type === "identity" && f.kinds.includes(e.identity.kind))) return false;
    if (skip !== "status" && f.statuses.length && !f.statuses.includes(statusOf(e).label)) return false;
    if (skip !== "risk" && f.risks.length && !(e.type === "identity" && f.risks.includes(e.identity.risk || "none"))) return false;
    if (skip !== "flag" && f.flags.length && !f.flags.every((x) => hasFlag(e, x, now, findingsOf))) return false;
    if (f.roles.length && !(e.type === "person" && e.person.last_app_roles.some((r) => f.roles.includes(r)))) return false;
    if (f.permissions.length && !(e.type === "person" && e.person.permissions.some((p) => f.permissions.includes(p)))) return false;
    const term = f.q.trim().toLowerCase();
    if (term) {
      const hay =
        e.type === "person"
          ? [e.person.name, e.person.email, e.person.sub, e.person.org_type, ...e.person.last_app_roles]
          : [e.identity.name, e.identity.id, e.identity.owner?.owner ?? "", e.identity.privileges, e.identity.credential, KIND_META[e.identity.kind].label];
      if (!hay.some((x) => x.toLowerCase().includes(term))) return false;
    }
    return true;
  };

  const rows = useMemo(() => {
    const order: Group[] = ["people", "agents", "machines"];
    const t = (e: Entry) => {
      const v = lastSeenOf(e);
      return v ? new Date(v).getTime() || 0 : 0;
    };
    const out = entries.filter((e) => matches(e));
    out.sort((a, b) => {
      const byName = entryName(a).localeCompare(entryName(b));
      const d =
        sort.key === "name" ? byName
        : sort.key === "kind" ? kindLabel(a).localeCompare(kindLabel(b)) || byName
        : sort.key === "last" ? t(b) - t(a) || byName
        : sort.key === "status" ? statusOf(a).label.localeCompare(statusOf(b).label) || byName
        : order.indexOf(groupOf(a)) - order.indexOf(groupOf(b)) || (a.type === "identity" && b.type === "identity" ? KINDS.indexOf(a.identity.kind) - KINDS.indexOf(b.identity.kind) : 0) || byName;
      return d * sort.dir;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, filter, sort, now, findingsOf]);

  const flip = <K extends "groups" | "kinds" | "statuses" | "risks" | "flags">(k: K, v: string) => {
    const cur = filter[k] as string[];
    onFilter({ ...filter, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };

  const groupChips: Chip[] = GROUPS.map((g) => ({ value: g.id, label: g.label, count: unread ? undefined : entries.filter((e) => groupOf(e) === g.id && matches(e, "group")).length, active: filter.groups.includes(g.id) }));
  const kindChips: Chip[] = KINDS.map((k) => ({ value: k, label: KIND_META[k].plural, count: unread ? undefined : entries.filter((e) => e.type === "identity" && e.identity.kind === k && matches(e, "kind")).length, active: filter.kinds.includes(k) }));
  const statusValues = [...new Set(entries.map((e) => statusOf(e).label))];
  const statusChips: Chip[] = statusValues.map((s) => {
    const tone = STATUS_TONE[s] ?? (s === "disabled" ? "err" : "neutral");
    return { value: s, label: s, count: unread ? undefined : entries.filter((e) => statusOf(e).label === s && matches(e, "status")).length, active: filter.statuses.includes(s), tone: tone === "err" ? "err" : tone === "warn" ? "warn" : undefined };
  });
  const riskChips: Chip[] = ["read", "write", "risky"].map((r) => ({
    value: r,
    label: riskLabel(r),
    count: unread ? undefined : entries.filter((e) => e.type === "identity" && (e.identity.risk || "none") === r && matches(e, "risk")).length,
    active: filter.risks.includes(r),
    tone: r === "risky" ? "err" : r === "write" ? "warn" : "ok",
  }));
  const flagChips: Chip[] = ROSTER_FLAGS.map((f) => ({ value: f.value, label: f.label, count: unread ? undefined : entries.filter((e) => hasFlag(e, f.value, now, findingsOf) && matches(e, "flag")).length, active: filter.flags.includes(f.value), tone: f.tone }));

  const active = [
    ...filter.groups.map((g) => ({ key: `groups:${g}`, label: GROUPS.find((x) => x.id === g)?.label ?? g })),
    ...filter.kinds.map((k) => ({ key: `kinds:${k}`, label: KIND_META[k as keyof typeof KIND_META]?.plural ?? k })),
    ...filter.statuses.map((s) => ({ key: `statuses:${s}`, label: s })),
    ...filter.risks.map((r) => ({ key: `risks:${r}`, label: riskLabel(r) })),
    ...filter.flags.map((f) => ({ key: `flags:${f}`, label: ROSTER_FLAGS.find((x) => x.value === f)?.label ?? f })),
    ...filter.roles.map((r) => ({ key: `roles:${r}`, label: `role ${r}` })),
    ...filter.permissions.map((p) => ({ key: `permissions:${p}`, label: `may ${p}` })),
    ...(filter.q.trim() ? [{ key: "q", label: `“${filter.q.trim()}”` }] : []),
  ];
  const clearOne = (k: string) => {
    if (k === "q") return onFilter({ ...filter, q: "" });
    const at = k.indexOf(":");
    const dim = k.slice(0, at) as "groups" | "kinds" | "statuses" | "risks" | "flags" | "roles" | "permissions";
    const v = k.slice(at + 1);
    onFilter({ ...filter, [dim]: (filter[dim] as string[]).filter((x) => x !== v) });
  };
  const more = filter.kinds.length + filter.statuses.length + filter.risks.length + filter.flags.length > 0;

  const sortBtn = (k: SortKey, label: string) => (
    <th className="px-3 py-2 font-medium whitespace-nowrap" aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((s.dir * -1) as 1 | -1) : 1 }))} className={`focusable inline-flex cursor-pointer items-center gap-1 rounded-sm ${sort.key === k ? "text-fg" : ""}`}>
        {label}
        <span aria-hidden className="w-2 text-[9px] text-faint">
          {sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );

  return (
    <>
      <div className="flex flex-col gap-2.5 border-b border-line px-4 py-3">
        <FilterBar count={active.length} onClear={() => onFilter(NO_FILTER)}>
          <Chips items={groupChips} label="Kind" onToggle={(v) => flip("groups", v)} />
          <SearchBox value={filter.q} onChange={(q) => onFilter({ ...filter, q })} placeholder="Name, email, id, role, owner" width="w-[260px]" />
        </FilterBar>
        <MoreFilters open={more}>
          <Chips items={flagChips} label="Only show" onToggle={(v) => flip("flags", v)} />
          <Chips items={kindChips} label="Type" onToggle={(v) => flip("kinds", v)} />
          <Chips items={riskChips} label="Reach" onToggle={(v) => flip("risks", v)} />
          <Chips items={statusChips} label="Status" onToggle={(v) => flip("statuses", v)} />
        </MoreFilters>
        <ActiveFilters items={active} onClear={clearOne} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] text-faint">
              <th className="py-2 pr-3 pl-4 font-medium whitespace-nowrap" aria-sort={sort.key === "name" ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                <button type="button" onClick={() => setSort((s) => ({ key: "name", dir: s.key === "name" ? ((s.dir * -1) as 1 | -1) : 1 }))} className={`focusable inline-flex cursor-pointer items-center gap-1 rounded-sm ${sort.key === "name" ? "text-fg" : ""}`}>
                  Name
                  <span aria-hidden className="w-2 text-[9px] text-faint">
                    {sort.key === "name" ? (sort.dir === 1 ? "▲" : "▼") : ""}
                  </span>
                </button>
              </th>
              {sortBtn("kind", "Kind")}
              <th className="px-3 py-2 font-medium whitespace-nowrap">Role or owner</th>
              {sortBtn("last", "Last seen")}
              {sortBtn("status", "Status")}
              <th className="w-8 py-2 pr-4 pl-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const mine = findingsOf.get(e.key) ?? [];
              const st = statusOf(e);
              const seen = lastSeenOf(e);
              const second = e.type === "person" ? e.person.email || e.person.sub : e.identity.kind === "api_key" ? e.identity.description : e.identity.id;
              return (
                <tr key={e.key} onClick={() => onOpen(e.key)} className={`cursor-pointer border-b border-line align-middle transition-colors last:border-0 hover:bg-raise/40 ${e.type === "person" && e.person.disabled_at ? "text-faint" : ""}`}>
                  <td className="py-2.5 pr-3 pl-4">
                    <span className="flex items-center gap-2.5">
                      <KindGlyph entry={e} />
                      <span className="flex max-w-[340px] min-w-0 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Link href={identityUrl(e.key)} onClick={(ev) => ev.stopPropagation()} className="focusable truncate rounded-sm text-[12.5px] font-medium text-fg hover:underline">
                            {entryName(e)}
                          </Link>
                          {mine.length > 0 && <span className={`size-1.5 shrink-0 rounded-[2px] ${mine.some((f) => f.severity === "err") ? "bg-err" : "bg-warn"}`} title={`${mine.length} finding${mine.length === 1 ? "" : "s"}`} />}
                          {e.type === "person" && e.person.sub === meSub && <Tag>you</Tag>}
                          {e.type === "person" && e.person.org_type && <Tag>{e.person.org_type}</Tag>}
                          {e.type === "identity" && Boolean(e.identity.facts.demo) && <Tag>sample</Tag>}
                        </span>
                        <span className="truncate font-mono text-[10.5px] text-faint" title={e.type === "identity" ? e.identity.description : undefined}>
                          {second}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-dim">{kindLabel(e)}</td>
                  <td className="px-3 py-2.5" onClick={e.type === "identity" && !e.identity.owner && !ownerStoreDown && e.identity.status !== "revoked" ? (ev) => ev.stopPropagation() : undefined}>
                    {e.type === "person" ? (
                      <span className="flex flex-wrap gap-1">{e.person.last_app_roles.length ? e.person.last_app_roles.map((r) => <Tag key={r}>{r}</Tag>) : <Tag tone="warn">no role in this app</Tag>}</span>
                    ) : e.identity.owner ? (
                      <OwnerChip owner={e.identity.owner} />
                    ) : e.identity.status === "revoked" ? (
                      <span className="text-faint">—</span>
                    ) : ownerStoreDown ? (
                      <span className="text-warn">no owner</span>
                    ) : (
                      <Button size="sm" variant="solid" tone="warn" permission="iam" onClick={() => onAssignOwner(e.key)}>
                        Assign owner
                      </Button>
                    )}
                  </td>
                  <td className="tnum px-3 py-2.5 whitespace-nowrap text-dim" title={seen ? new Date(seen).toLocaleString() : undefined}>
                    {seen ? ago(seen, now) : e.type === "person" ? "" : <span className="text-faint">none on record</span>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <Status tone={st.tone}>{st.label}</Status>
                  </td>
                  <td className="py-2.5 pr-4 pl-1 text-right text-faint" aria-hidden>
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-5 text-center text-[12px] text-faint">
                  {unread ? "The roster could not be read in full, so it is not listed as empty." : entries.length === 0 ? "Nobody has signed in and no identity is on the register yet." : "Nothing matches these filters."}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-[12px] text-faint">
                  Reading the roster…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
