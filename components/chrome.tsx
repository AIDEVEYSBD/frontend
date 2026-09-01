"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme";
import { Material, SurfaceGrain } from "./material";
import { AFMark } from "./brand";

const NAV = [
  { href: "/control", label: "Control" },
  { href: "/builder", label: "Builder" },
  { href: "/workflows", label: "Workflows" },
  { href: "/roster", label: "Roster" },
  { href: "/runs", label: "Runs" },
  { href: "/evals", label: "Evals" },
  { href: "/settings", label: "Settings" },
  // The design page is a workbench for this codebase, not a feature.
  ...(process.env.NODE_ENV === "development" ? [{ href: "/design", label: "Design" }] : []),
];

export function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // The landing page carries its own header and footer.
  if (pathname === "/") return <>{children}</>;

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
            {NAV.map((item) => {
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

        <div className="relative"><ThemeToggle /></div>
      </header>

      {/* The app never scrolls the document — pages scroll inside main.
          A canvas page fills it exactly; a prose page scrolls within it. */}
      <main className="min-h-0 grow overflow-y-auto overscroll-contain">{children}</main>
    </div>
  );
}
