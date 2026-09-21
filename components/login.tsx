"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui";
import { AFMark } from "./brand";

/**
 * The sign-in page: warm the identity provider, then go.
 *
 * The provider may be cold, so the page probes its health endpoint until it
 * answers with its own JSON and only then navigates to the authorization
 * endpoint. A person who arrived because of an error sees which error, in
 * plain words, and one button that starts a fresh sign-in.
 */

const ISSUER = "https://sso.autogrc.cloud";

const ERRORS: Record<string, string> = {
  expired: "The sign-in request expired before it could be completed. Please start again.",
  exchange: "The identity provider could not complete the sign-in. Please try again. If the issue continues, contact the platform team.",
  unconfigured: "Single sign-on has not been configured for this deployment.",
};

export function Login({ next, error }: { next: string; error: string }) {
  const [state, setState] = useState<"probing" | "ready" | "cold" | "failed">("probing");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (error === "unconfigured") return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const probe = async (n: number) => {
      if (stop) return;
      setAttempt(n);
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), n === 0 ? 20_000 : 8_000);
        const r = await fetch(`${ISSUER}/health`, { signal: ctl.signal, cache: "no-store" });
        clearTimeout(t);
        const ct = r.headers.get("content-type") ?? "";
        const body = ct.includes("json") ? await r.json().catch(() => null) : null;
        if (r.ok && body && body.status === "ok") {
          setState("ready");
          if (!error) window.location.href = `/api/auth/login?next=${encodeURIComponent(next)}`;
          return;
        }
        setState("cold");
      } catch {
        setState("cold");
      }
      if (n >= 12) {
        setState("failed");
        return;
      }
      timer = setTimeout(() => probe(n + 1), Math.min(1500 * (n + 1), 6000));
    };
    probe(0);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [next, error]);

  const go = () => {
    window.location.href = `/api/auth/login?next=${encodeURIComponent(next)}`;
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="flex w-[min(440px,100%)] flex-col gap-5 rounded-lg border border-line bg-surface p-7 elev-2">
        <span className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-ink text-on-ink"><AFMark size={16} /></span>
          <span className="text-[14px] font-bold tracking-tight">Agent Factory</span>
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-[20px] leading-tight font-semibold tracking-[-0.01em]">Sign in</span>
          <span className="text-[12.5px] leading-[1.55] text-faint">Continue to AutoX single sign-on to access Agent Factory.</span>
        </span>

        {error && ERRORS[error] && <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[12px] leading-[1.5] text-err">{ERRORS[error]}</p>}

        {error !== "unconfigured" && (
          <p className="text-[12px] text-faint" aria-live="polite">
            {state === "probing" && "Connecting to sign-in…"}
            {state === "cold" && `Waiting for the sign-in service… (attempt ${attempt + 1})`}
            {state === "ready" && (error ? "Sign-in service is ready." : "Redirecting to sign-in…")}
            {state === "failed" && "The sign-in service did not answer. Try again in a moment."}
          </p>
        )}

        <span className="flex items-center gap-2">
          <Button size="md" variant="solid" tone="ink" disabled={error === "unconfigured" || state === "probing"} onClick={go}>
            {error ? "Sign in again" : "Sign in"}
          </Button>
          {state === "failed" && <Button size="md" variant="quiet" onClick={() => window.location.reload()}>Retry</Button>}
        </span>
      </div>
    </div>
  );
}

const REASONS: Record<string, { title: string; body: string }> = {
  unassigned: { title: "A role is required to access Agent Factory", body: "Your AutoX account was authenticated, but it has not been assigned an Agent Factory role. Contact your single sign-on administrator, then sign in again after the role has been assigned." },
  provisioning: { title: "Agent Factory could not complete account provisioning", body: "Your identity was authenticated, but Agent Factory could not create or update the corresponding user record. Contact the platform team; diagnostic information is available in the identity and access audit trail." },
  disabled: { title: "Your access to Agent Factory has been disabled", body: "Your identity remains valid, but an Agent Factory administrator has disabled your access to this deployment. Contact an administrator to request reinstatement." },
};

export function NoAccess({ reason }: { reason: string }) {
  const r = REASONS[reason] ?? { title: "Agent Factory is currently unavailable", body: "Sign in again to start a new authorization request." };
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="flex w-[min(480px,100%)] flex-col gap-4 rounded-lg border border-line bg-surface p-7 elev-2">
        <span className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-ink text-on-ink"><AFMark size={16} /></span>
          <span className="text-[14px] font-bold tracking-tight">Agent Factory</span>
        </span>
        <span className="text-[18px] leading-tight font-semibold tracking-[-0.01em]">{r.title}</span>
        <p className="text-[12.5px] leading-[1.6] text-faint">{r.body}</p>
        <span className="flex items-center gap-2">
          {/* A fresh authorization, never a reload of the session that was refused. */}
          <Button size="md" variant="solid" tone="ink" onClick={() => { window.location.href = "/api/auth/login?next=%2Fcontrol"; }}>Sign in again</Button>
          {reason === "disabled" && (
            <Button size="md" variant="solid" tone="err" onClick={async () => { const j = await fetch("/api/auth/logout", { method: "POST" }).then((x) => x.json()).catch(() => ({})); window.location.href = j.redirect || "/"; }}>Sign out</Button>
          )}
        </span>
      </div>
    </div>
  );
}
