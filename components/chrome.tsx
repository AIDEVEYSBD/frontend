"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme";
import { CURRENT_USER } from "@/lib/user";
import { useSession } from "@/lib/use-session";
import { Button } from "./ui";
import { Material, SurfaceGrain } from "./material";
import { AFMark } from "./brand";
import { useEffect, useState } from "react";
import { Assistant } from "./assistant";
import { applyAccent } from "./appearance";

const NAV = [
  { href: "/control", label: "Control" },
  { href: "/finops", label: "FinOps" },
  { href: "/builder", label: "Builder" },
  { href: "/workflows", label: "Workflows" },
  { href: "/roster", label: "Roster" },
  { href: "/runs", label: "Runs" },
  { href: "/evals", label: "Evals" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/guardrails", label: "Controls" },
  { href: "/iam", label: "IAM" },
  { href: "/configuration", label: "Configuration" },
  { href: "/settings", label: "Settings" },
  // The design page (/design) is a workbench for this codebase, reached by URL, never from the nav.
];

export function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, loaded, can, signOut } = useSession();
  const [denied, setDenied] = useState<string | null>(null);

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
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if ((res.status === 403 || res.status === 401) && url.startsWith("/api/") && !url.startsWith("/api/auth/")) {
        try {
          const j = (await res.clone().json()) as { error?: string; reauth?: boolean };
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

  // The landing page carries its own header and footer; sign-in pages stand alone.
  if (pathname === "/" || pathname === "/login" || pathname === "/no-access") return <>{children}</>;
  const who = session ?? { name: CURRENT_USER.name, initials: CURRENT_USER.initials, appRoles: [] as string[], sso: false, demoDefaultApplied: false, email: "" };
  const roleLabel = who.sso ? (who.appRoles.length ? who.appRoles.join(", ") : who.demoDefaultApplied ? "demo default role" : "no role") : CURRENT_USER.role;
  const nav = NAV.filter((item) => item.href !== "/iam" || !loaded || can("iam"));

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <Material />
      <header className="relative z-20 flex h-12 shrink-0 items-center gap-6 border-b border-line bg-surface px-4">
        <SurfaceGrain />
        <Link href="/" className="focusable relative flex shrink-0 items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-ink text-on-ink">
            <AFMark size={15} />
          </span>
          <span className="hidden whitespace-nowrap text-[13px] font-bold tracking-tight text-on-grain sm:inline">Agent Factory</span>
        </Link>

        <div className="relative min-w-0">
          <nav className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {nav.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`focusable shrink-0 rounded-sm px-2.5 py-1 text-[13px] whitespace-nowrap transition-colors duration-100 ${
                    active
                      ? "bg-raise font-bold text-on-grain"
                      : "font-semibold text-dim hover:text-on-grain"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          {/* On narrow screens the nav scrolls; the fade says there is more. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-r from-transparent to-surface sm:hidden"
          />
        </div>

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
      {denied && (
        <div role="alert" className="fixed bottom-5 left-1/2 z-50 flex max-w-[560px] -translate-x-1/2 items-center gap-2 rounded-md border border-err/50 bg-surface px-3 py-2 text-[12px] text-err elev-3">
          <span className="size-1.5 shrink-0 rounded-full bg-err" />
          {denied}
        </div>
      )}
    </div>
  );
}
