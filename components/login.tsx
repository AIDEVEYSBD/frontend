"use client";

import { Button } from "./ui";
import { BrandLockup } from "./brand";

/**
 * Why someone was not let in: the reasons the platform's sign-in door
 * (/api/auth/login) sends to /no-access.
 */

const REASONS: Record<string, { title: string; body: string }> = {
  unassigned: { title: "A role is required to access Saros", body: "Ask an administrator for a role, then sign in again." },
  "iap-missing": { title: "This console is reached through Google sign-in", body: "Open the console at its published address." },
  "iap-invalid": { title: "Your Google sign-in could not be verified", body: "Try again; if it continues, contact the platform team." },
  disabled: { title: "An administrator has ended your access", body: "Ask an administrator if you need access again." },
};

export function NoAccess({ reason }: { reason: string }) {
  const r = REASONS[reason] ?? { title: "Saros is currently unavailable", body: "Sign in again to start a new authorization request." };
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="flex w-[min(480px,100%)] flex-col gap-4 rounded-lg border border-line bg-surface p-7 elev-2">
        <BrandLockup />
        <span className="text-[18px] leading-tight font-semibold tracking-[-0.01em]">{r.title}</span>
        <p className="text-[12.5px] leading-[1.6] text-faint">{r.body}</p>
        <span className="flex items-center gap-2">
          {/* A fresh authorization, never a reload of the session that was refused. */}
          <Button size="md" variant="solid" tone="ink" onClick={() => { window.location.href = "/api/auth/login?next=%2Foverview"; }}>Sign in again</Button>
          {reason === "disabled" && (
            <Button size="md" variant="solid" tone="err" onClick={async () => { const j = await fetch("/api/auth/logout", { method: "POST" }).then((x) => x.json()).catch(() => ({})); window.location.href = j.redirect || "/"; }}>Sign out</Button>
          )}
        </span>
      </div>
    </div>
  );
}
