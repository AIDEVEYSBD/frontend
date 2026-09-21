"use client";

import { useEffect, useState } from "react";
import type { Permission } from "@/lib/permissions";

/**
 * The signed-in person, on the client.
 *
 * One fetch, shared by every component that asks, so the header chip, the
 * approval dialog and the knowledge admissions agree on who is here. In
 * local mode (no identity provider configured) the answer is the console's
 * operator with every permission, which is what the platform did before.
 */

export interface SessionInfo {
  signedIn: boolean;
  sso: boolean;
  mode: "sso" | "local" | "internal";
  sub: string;
  name: string;
  email: string;
  initials: string;
  orgType: string;
  isEy: boolean;
  roles: string[];
  appRoles: string[];
  permissions: Permission[];
  demoDefaultApplied: boolean;
  disabled: boolean;
  accessExpiresAt: string | null;
  expiresAt: string | null;
  reauth?: boolean;
}

let cached: SessionInfo | null = null;
let inflight: Promise<SessionInfo | null> | null = null;
const listeners = new Set<(s: SessionInfo | null) => void>();

export async function loadSession(force = false): Promise<SessionInfo | null> {
  if (cached && !force) return cached;
  if (!inflight) {
    inflight = fetch("/api/auth/session", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as SessionInfo;
        cached = j.signedIn ? j : null;
        if (!j.signedIn && j.reauth && typeof window !== "undefined") {
          window.location.href = `/api/auth/login?next=${encodeURIComponent(window.location.pathname)}`;
        }
        return cached;
      })
      .catch(() => cached)
      .finally(() => {
        inflight = null;
        listeners.forEach((l) => l(cached));
      });
  }
  return inflight;
}

export function useSession(): { session: SessionInfo | null; loaded: boolean; can: (p: Permission) => boolean; signOut: () => Promise<void> } {
  const [session, setSession] = useState<SessionInfo | null>(cached);
  const [loaded, setLoaded] = useState(Boolean(cached));
  useEffect(() => {
    const l = (s: SessionInfo | null) => {
      setSession(s);
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
    can: (p) => (session ? session.permissions.includes(p) : false),
    signOut: async () => {
      const r = await fetch("/api/auth/logout", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { redirect?: string };
      cached = null;
      window.location.href = j.redirect || "/";
    },
  };
}

/** The name a client-side action should sign with. Falls back to the local operator's name until the session loads. */
export function signerName(s: SessionInfo | null, fallback: string): string {
  return s ? s.name || s.email || fallback : fallback;
}
