"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme";
import { CURRENT_USER } from "@/lib/user";
import { useSession } from "@/lib/use-session";
import { Button } from "./ui";
import { Material } from "./material";
import { BrandLockup, ABBWordmark } from "./brand";
import { NavIcon, type NavIconName } from "./nav-icons";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useDismiss } from "./dismiss";
import { Assistant } from "./assistant";
import { applyAccent } from "./appearance";
import { isOpenPage } from "@/lib/route-policy";
import { consolePath } from "@/lib/api/client";

/**
 * The navigation, grouped. Five groups by what a person came to do: watch
 * and run the estate, build what runs in it, see what it is made of, govern
 * it, administer the platform. The sidebar draws each group as a row that
 * opens into a sub-menu of its pages; collapsed, it is a rail of the group
 * icons, each opening its sub-menu as a fly-out. The pattern is the DLP
 * Agent console's; the black bar is the ABB consoles'.
 */
type Group = "Operations" | "Build" | "Estate" | "Governance" | "Platform";
const GROUPS: Group[] = ["Operations", "Build", "Estate", "Governance", "Platform"];
const GROUP_ICON: Record<Group, NavIconName> = {
  Operations: "layout-dashboard",
  Build: "pencil-ruler",
  Estate: "network",
  Governance: "shield",
  Platform: "sliders-horizontal",
};

const NAV: { href: string; label: string; group: Group; icon: NavIconName }[] = [
  { href: "/control", label: "Control", group: "Operations", icon: "layout-dashboard" },
  { href: "/runs", label: "Runs", group: "Operations", icon: "list-checks" },
  { href: "/deliverables", label: "Deliverables", group: "Operations", icon: "file-check" },
  { href: "/finops", label: "FinOps", group: "Operations", icon: "wallet" },

  { href: "/builder", label: "Builder", group: "Build", icon: "pencil-ruler" },
  { href: "/workflows", label: "Workflows", group: "Build", icon: "workflow" },
  { href: "/templates", label: "Templates", group: "Build", icon: "layout-template" },
  { href: "/applications", label: "Applications", group: "Build", icon: "app-window" },
  { href: "/lifecycle", label: "Lifecycle", group: "Build", icon: "milestone" },
  { href: "/evals", label: "Evals", group: "Build", icon: "flask-conical" },
  { href: "/knowledge", label: "Knowledge", group: "Build", icon: "book-open" },

  { href: "/roster", label: "Roster", group: "Estate", icon: "bot" },
  { href: "/dependencies", label: "Dependencies", group: "Estate", icon: "network" },
  { href: "/drift", label: "Drift", group: "Estate", icon: "git-compare" },
  { href: "/guardian", label: "Guardian", group: "Estate", icon: "shield-check" },
  { href: "/peers", label: "Peers", group: "Estate", icon: "waypoints" },
  { href: "/breakers", label: "Breakers", group: "Estate", icon: "zap-off" },

  { href: "/guardrails", label: "Controls", group: "Governance", icon: "shield" },
  { href: "/policy", label: "Policy", group: "Governance", icon: "book-open-check" },
  { href: "/evidence", label: "Evidence", group: "Governance", icon: "folder-check" },
  { href: "/attestations", label: "Attestations", group: "Governance", icon: "badge-check" },
  { href: "/frameworks", label: "Frameworks", group: "Governance", icon: "layers" },
  { href: "/ledger", label: "Ledger", group: "Governance", icon: "scroll-text" },
  { href: "/bom", label: "AI-BOM", group: "Governance", icon: "package" },

  { href: "/iam", label: "IAM", group: "Platform", icon: "key-round" },
  { href: "/configuration", label: "Configuration", group: "Platform", icon: "sliders-horizontal" },
  { href: "/settings", label: "Settings", group: "Platform", icon: "settings" },
  // The design page (/design) is a workbench for this codebase, reached by URL, never from the nav.
];
type NavItem = (typeof NAV)[number];

/* What the sidebar remembers, per browser: collapsed or not, and which groups are shut.
   Every group starts shut; the one holding the page a person is on opens by itself. */
interface Prefs { rail: boolean; closed: string[] }
const PREF_KEY = "af.sidebar";
const DEFAULT_PREFS: Prefs = { rail: false, closed: [...GROUPS] };
let prefs: Prefs | null = null;
const watchers = new Set<() => void>();

function readPrefs(): Prefs {
  if (prefs === null) {
    try {
      prefs = { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Partial<Prefs>) };
    } catch {
      prefs = DEFAULT_PREFS;
    }
  }
  return prefs;
}

function remember(next: Prefs) {
  prefs = next;
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the choice holds for this page */
  }
  watchers.forEach((w) => w());
}

function watch(w: () => void) {
  watchers.add(w);
  return () => watchers.delete(w);
}

/** Server and first client render agree on the open sidebar; the stored choice takes over after. */
const usePrefs = () => useSyncExternalStore(watch, readPrefs, () => DEFAULT_PREFS);

/* ── The groups a person reaches ── */

interface NavGroup {
  label: Group;
  items: NavItem[];
  /** The page of this group the person is on, if any. */
  here: NavItem | undefined;
}

function groupsOf(items: NavItem[], pathname: string): NavGroup[] {
  // The longest matching href wins, so a nested route lights its own entry only.
  const best = items.filter((n) => pathname.startsWith(n.href)).sort((x, y) => y.href.length - x.href.length)[0];
  return GROUPS.map((label) => {
    const mine = items.filter((n) => n.group === label);
    return { label, items: mine, here: mine.find((n) => n.href === best?.href) };
  }).filter((g) => g.items.length);
}

/* The sidebar is black in both themes, as ABB's consoles have it, so what sits on it is white at
   a few strengths and its focus ring is light. The fly-out floats over the page and takes the page's colours. */
const SIDE = "border-r border-[var(--t-side-line)] bg-[var(--t-side)] text-white";
const SIDE_FOCUS = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70";
const SUB = "relative flex items-center rounded-md px-2.5 py-1.5 text-[13px] whitespace-nowrap transition-colors duration-100";
const subOnSide = (active: boolean) => (active ? "bg-white/10 font-semibold text-white" : "font-medium text-white/65 hover:bg-white/8 hover:text-white");
const subOnSurface = (active: boolean) => (active ? "bg-raise font-semibold text-fg" : "font-medium text-dim hover:bg-raise/60 hover:text-fg");

/**
 * The navigation as groups that open into sub-menus: the sidebar at full
 * width, and the drawer. `auto` is the group opened because the person
 * arrived on one of its pages; shutting it by hand lets it go.
 */
function NavGroups({ groups, auto, onAuto, onNavigate }: { groups: NavGroup[]; auto: Group | null; onAuto: (g: Group | null) => void; onNavigate?: () => void }) {
  const { rail, closed } = usePrefs();
  return (
    <nav aria-label="Main" className="flex min-h-0 grow flex-col gap-1 overflow-y-auto px-2.5 py-3 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]">
      {groups.map((g) => {
        const open = !closed.includes(g.label) || auto === g.label;
        const toggle = () => {
          if (open) {
            if (auto === g.label) onAuto(null);
            remember({ rail, closed: closed.includes(g.label) ? closed : [...closed, g.label] });
          } else remember({ rail, closed: closed.filter((c) => c !== g.label) });
        };
        return (
          <div key={g.label} className="flex flex-col">
            <button
              type="button"
              aria-expanded={open}
              onClick={toggle}
              className={`${SIDE_FOCUS} flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] font-semibold transition-colors duration-100 hover:bg-white/8 ${g.here && !open ? "text-white" : "text-white/80 hover:text-white"}`}
            >
              <NavIcon name={GROUP_ICON[g.label]} />
              <span className="grow truncate">{g.label}</span>
              <NavIcon name="chevron-right" size={11} className={`text-white/40 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
            </button>
            {open && (
              <div className="mt-0.5 mb-1 ml-[17px] flex flex-col gap-0.5 border-l border-white/12 pl-2">
                {g.items.map((item) => {
                  const active = g.here?.href === item.href;
                  return (
                    <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`${SIDE_FOCUS} ${SUB} ${subOnSide(active)}`}>
                      {active && <span aria-hidden className="absolute inset-y-1.5 -left-[9px] w-[2px] rounded-full bg-brand" />}
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** One group on the collapsed rail: its icon, and its sub-menu as a fly-out beside it. */
function RailGroup({ g }: { g: NavGroup }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title={g.label}
        aria-label={g.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${SIDE_FOCUS} relative grid size-9 cursor-pointer place-items-center rounded-md transition-colors duration-100 ${g.here || open ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/8 hover:text-white"}`}
      >
        {g.here && <span aria-hidden className="absolute inset-y-2 -left-[9px] w-[3px] rounded-full bg-brand" />}
        <NavIcon name={GROUP_ICON[g.label]} size={17} />
      </button>
      {open && (
        <div role="menu" aria-label={g.label} className="af-fade-up absolute top-0 left-full z-40 ml-3 flex w-[208px] flex-col gap-0.5 rounded-lg border border-line bg-surface p-1.5 text-fg elev-3">
          <span className="px-2.5 pt-1 pb-1.5 text-[10px] font-medium tracking-[0.09em] text-faint uppercase">{g.label}</span>
          {g.items.map((item) => {
            const active = g.here?.href === item.href;
            return (
              <Link key={item.href} role="menuitem" href={item.href} onClick={close} aria-current={active ? "page" : undefined} className={`focusable ${SUB} gap-2.5 ${subOnSurface(active)}`}>
                <NavIcon name={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The switch at the foot of the sidebar: collapse it to its rail, or open it again. */
function CollapseButton({ rail }: { rail: boolean }) {
  const label = rail ? "Expand the sidebar" : "Collapse the sidebar";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={rail}
      onClick={() => remember({ ...readPrefs(), rail: !rail })}
      className={`${SIDE_FOCUS} flex cursor-pointer items-center gap-2.5 rounded-md text-[12.5px] font-medium text-white/60 transition-colors duration-100 hover:bg-white/8 hover:text-white ${rail ? "size-9 justify-center" : "w-full px-2.5 py-1.5"}`}
    >
      <NavIcon name="panel-left" size={16} />
      {!rail && "Collapse"}
    </button>
  );
}

function Sidebar({ groups, auto, onAuto }: { groups: NavGroup[]; auto: Group | null; onAuto: (g: Group | null) => void }) {
  const { rail } = usePrefs();
  if (rail) {
    return (
      <aside className={`relative z-30 hidden w-14 shrink-0 flex-col items-center lg:flex ${SIDE}`} data-sidebar="rail">
        <Link href="/" aria-label="Agent Factory, home" className={`${SIDE_FOCUS} flex h-12 w-full shrink-0 items-center justify-center border-b border-white/10`}>
          <ABBWordmark height={11} />
        </Link>
        <nav aria-label="Main" className="flex grow flex-col items-center gap-1.5 py-3">
          {groups.map((g) => <RailGroup key={g.label} g={g} />)}
        </nav>
        <div className="flex w-full shrink-0 justify-center border-t border-white/10 py-2"><CollapseButton rail /></div>
      </aside>
    );
  }
  return (
    <aside className={`relative z-30 hidden w-[224px] shrink-0 flex-col lg:flex ${SIDE}`} data-sidebar="full">
      <Link href="/" aria-label="Agent Factory, home" className={`${SIDE_FOCUS} flex h-12 shrink-0 items-center border-b border-white/10 px-4`}>
        <BrandLockup onDark />
      </Link>
      <NavGroups groups={groups} auto={auto} onAuto={onAuto} />
      <div className="flex shrink-0 flex-col border-t border-white/10 px-2.5 py-2">
        <CollapseButton rail={false} />
      </div>
    </aside>
  );
}

export function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, loaded, can, signOut } = useSession();
  const [denied, setDenied] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);

  // Appearance is a server-side setting; apply it once the page is up.
  useEffect(() => {
    fetch("/api/ui", { cache: "no-store" }).then((r) => r.json()).then((d) => applyAccent(Boolean(d.accent))).catch(() => {});
  }, []);

  // Role-based access, the last line: any console API answer of 401 or 403
  // surfaces here as a notice, whichever page made the call.
  useEffect(() => {
    const w = window as Window & { __afFetchGuard?: boolean };
    if (w.__afFetchGuard) return;
    w.__afFetchGuard = true;
    const orig = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await orig(input, init);
      // A plain fetch names the path; the generated client (lib/api/client.ts) sends a Request, whose URL is absolute on this origin.
      const url = consolePath(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if ((res.status === 403 || res.status === 401) && url.startsWith("/api/") && !url.startsWith("/api/auth/")) {
        try {
          const j = (await res.clone().json()) as { error?: string; reauth?: boolean };
          // A route handler that redirects to the identity provider, not a page: a client-side navigation cannot follow it.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          if (j.reauth) window.location.href = `/api/auth/login?next=${encodeURIComponent(window.location.pathname)}`;
          else window.dispatchEvent(new CustomEvent("af:denied", { detail: j.error ?? "not permitted" }));
        } catch {
          /* not JSON */
        }
      }
      return res;
    };
    const onDenied = (e: Event) => {
      setDenied(String((e as CustomEvent).detail));
      setTimeout(() => setDenied(null), 6000);
    };
    window.addEventListener("af:denied", onDenied);
    return () => window.removeEventListener("af:denied", onDenied);
  }, []);

  const nav = NAV.filter((item) => item.href !== "/iam" || !loaded || can("iam"));
  const groups = groupsOf(nav, pathname);
  const hereGroup = groups.find((g) => g.here);
  const here = hereGroup?.here;
  // The group a person arrives in opens by itself, and again each time they arrive in another.
  const at = hereGroup?.label ?? null;
  const [seen, setSeen] = useState<Group | null>(at);
  const [auto, setAuto] = useState<Group | null>(at);
  if (seen !== at) {
    setSeen(at);
    setAuto(at);
  }

  // The landing page carries its own header and footer; sign-in pages stand
  // alone; so does the external answer page, which an outside participant
  // opens with a signed link and no session (lib/route-policy.ts OPEN_PAGES).
  if (isOpenPage(pathname)) return <>{children}</>;
  const who = session ?? { name: CURRENT_USER.name, initials: CURRENT_USER.initials, appRoles: [] as string[], sso: false, demoDefaultApplied: false, email: "" };
  const roleLabel = who.sso ? (who.appRoles.length ? who.appRoles.join(", ") : who.demoDefaultApplied ? "default role (no assignment)" : "no role") : CURRENT_USER.role;
  return (
    <div className="flex h-screen bg-canvas">
      <Material />
      <Sidebar groups={groups} auto={auto} onAuto={setAuto} />

      <div className="flex min-w-0 grow flex-col">
        <header className="relative z-20 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          {/* Below the sidebar's width the navigation is a drawer, opened from here. */}
          <button
            type="button"
            aria-label="Open the navigation"
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
            className="focusable grid size-7 shrink-0 cursor-pointer place-items-center rounded-md bg-raise text-fg lg:hidden"
          >
            <NavIcon name="menu" size={15} />
          </button>
          <Link href="/" aria-label="Agent Factory, home" className="focusable flex shrink-0 lg:hidden"><ABBWordmark height={13} /></Link>
          <span className="truncate text-[13px] font-semibold text-fg lg:hidden">{here?.label}</span>

          {here && (
            <span className="hidden min-w-0 items-center gap-1.5 text-[12px] whitespace-nowrap text-faint lg:flex">
              {here.group}
              <NavIcon name="chevron-right" size={11} className="text-ghost" />
              <span className="truncate font-medium text-fg">{here.label}</span>
            </span>
          )}

          <div className="grow" />
          <span className="mr-2 hidden items-center gap-2 sm:flex" title={`${who.name}${who.email ? ` · ${who.email}` : ""} · ${roleLabel}`}>
            <span className="grid size-6 place-items-center rounded-full bg-ink text-[9.5px] font-semibold text-on-ink">{who.initials}</span>
            <span className="flex flex-col leading-tight">
              <span className="text-[11.5px] font-medium text-fg">{who.name}</span>
              <span className="text-[9.5px] text-faint">{roleLabel}</span>
            </span>
            {who.sso && (
              <Button size="sm" variant="solid" tone="err" onClick={signOut}>Sign out</Button>
            )}
          </span>

          <div className="relative"><ThemeToggle /></div>
        </header>
        <Assistant />

        {/* The app never scrolls the document — pages scroll inside main.
            A canvas page fills it exactly; a prose page scrolls within it. */}
        <main className="min-h-0 grow overflow-y-auto overscroll-contain">{children}</main>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button type="button" aria-label="Close the navigation" onClick={() => setDrawer(false)} className="absolute inset-0 cursor-default bg-black/45" />
          <div role="dialog" aria-modal="true" aria-label="Navigation" className={`relative flex h-full w-[248px] max-w-[85vw] flex-col elev-3 ${SIDE}`} data-sidebar="drawer">
            <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-white/10 pr-2.5 pl-4">
              <BrandLockup onDark />
              <button type="button" aria-label="Close the navigation" onClick={() => setDrawer(false)} className={`${SIDE_FOCUS} grid size-7 shrink-0 cursor-pointer place-items-center rounded-md bg-white/10 text-white hover:bg-white/15`}>
                <NavIcon name="x" size={14} />
              </button>
            </div>
            <NavGroups groups={groups} auto={auto} onAuto={setAuto} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      {denied && (
        <div role="alert" className="fixed bottom-5 left-1/2 z-50 flex max-w-[560px] -translate-x-1/2 items-center gap-2 rounded-md border border-err/50 bg-surface px-3 py-2 text-[12px] text-err elev-3">
          <span className="size-1.5 shrink-0 rounded-full bg-err" />
          {denied}
        </div>
      )}
    </div>
  );
}
