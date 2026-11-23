"use client";

import { useEffect, useState } from "react";
import type { Permission } from "@/lib/permissions";

/**
 * The signed-in person, on the client.
 *
 * One fetch, shared by every component that asks, so the header chip, the
 * approval dialog and the knowledge admissions agree on who is here. The
 * service answers it (GET /api/auth/session) from the assertion Google
 * Identity-Aware Proxy signed; there is no other way in and no local mode.
 */

export interface SessionInfo {
  signedIn: boolean;
  sso: boolean;
  mode: "sso";
  /** Which way a signed-in person came in: always Identity-Aware Proxy. */
  via: "iap";
  /** Whether a sign-out button means anything (behind IAP it needs IAP's own sign-out address). */
  canSignOut?: boolean;
  sub: string;
  name: string;
  email: string;
  initials: string;
  roles: string[];
  appRoles: string[];
  /** The identity provider's group claims (absent from an older console's answer): roles for a gate's approvers, as the backend reads them. */
  groups?: string[];
  permissions: Permission[];
  disabled: boolean;
  accessExpiresAt: string | null;
  expiresAt: string | null;
  reauth?: boolean;
  /** The origin machines reach the service at, outside the console's sign-in (the backend's PUBLIC_API_URL); null when the deployment names none. Absent from an older backend's answer, which is read as none. */
  machineOrigin?: string | null;
}

/**
 * Why the session could not be read, when it could not: the status and the
 * platform's own reason. The platform answers 503 with an `error` when it
 * cannot read its sign-in keys, and 401 with a `reason` when the sign-in it
 * was handed does not verify. Never shown as "not signed in".
 */
export interface SessionFailure {
  status: number;
  reason: string;
}

let cached: SessionInfo | null = null;
let failed: SessionFailure | null = null;
let inflight: Promise<SessionInfo | null> | null = null;
const listeners = new Set<(s: SessionInfo | null) => void>();

/** Where a person an administrator has held out is sent: the page that says so in a plain sentence. */
const HELD_OUT = "/no-access?reason=disabled";

export async function loadSession(force = false): Promise<SessionInfo | null> {
  if (cached && !force) return cached;
  if (!inflight) {
    inflight = fetch("/api/auth/session", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as (Partial<SessionInfo> & { error?: string; reason?: string }) | null;
        if (j && !j.signedIn && j.reauth && typeof window !== "undefined") {
          window.location.href = `/api/auth/login?next=${encodeURIComponent(window.location.pathname)}`;
        }
        if (!r.ok || !j) {
          cached = null;
          failed = { status: r.status, reason: (j && (j.error || j.reason)) || `the platform answered ${r.status} with no reason` };
          return cached;
        }
        if (!j.signedIn) {
          cached = null;
          failed = { status: r.status, reason: j.reason || j.error || "the platform says nobody is signed in" };
          return cached;
        }
        failed = null;
        cached = j as SessionInfo;
        // Held out by an administrator: signed in, with no roles. They are sent to the page that says so.
        if (j.disabled && typeof window !== "undefined" && !window.location.pathname.startsWith("/no-access")) {
          window.location.replace(HELD_OUT);
        }
        return cached;
      })
      .catch((e) => {
        failed = { status: 0, reason: `the platform did not answer GET /api/auth/session (${(e as Error).message})` };
        return cached;
      })
      .finally(() => {
        inflight = null;
        listeners.forEach((l) => l(cached));
      });
  }
  return inflight;
}

export function useSession(): { session: SessionInfo | null; loaded: boolean; failure: SessionFailure | null; can: (p: Permission) => boolean; signOut: () => Promise<void> } {
  const [session, setSession] = useState<SessionInfo | null>(cached);
  const [loaded, setLoaded] = useState(Boolean(cached));
  const [failure, setFailure] = useState<SessionFailure | null>(failed);
  useEffect(() => {
    const l = (s: SessionInfo | null) => {
      setSession(s);
      setFailure(failed);
      setLoaded(true);
    };
    listeners.add(l);
    loadSession().then(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return {
    session,
    loaded,
    failure,
    can: (p) => (session ? session.permissions.includes(p) : false),
    signOut: async () => {
      const r = await fetch("/api/auth/logout", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { redirect?: string };
      cached = null;
      window.location.href = j.redirect || "/";
    },
  };
}

/**
 * The origin machines reach the service at, as the session answers it (lib/site.ts says why it is not the console's):
 * `undefined` until the session is read, null when the deployment names none.
 *
 * Also `undefined` on a component's first render, as on the server: a part of a page that hydrates after the session
 * was read elsewhere must first render what the server rendered, or React discards the server's HTML.
 */
export function useMachineOrigin(): string | null | undefined {
  const { session } = useSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && session ? (session.machineOrigin ?? null) : undefined;
}

/** The name a client-side action should sign with. `fallback` until the session loads. */
export function signerName(s: SessionInfo | null, fallback: string): string {
  return s ? s.name || s.email || fallback : fallback;
}
