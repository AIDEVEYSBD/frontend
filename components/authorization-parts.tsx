"use client";

import { Status, type Tone } from "./ui";
import type { AuthServerActsAs, AuthServerPurpose, AuthServerRegistration, AuthServerState } from "@/lib/api/pending";

/**
 * What the authorization servers page and its add dialog share: how a
 * server's purpose, registration, state and subjects are worded. Nothing
 * here holds a record.
 */

export const PURPOSES: Record<AuthServerPurpose, { label: string; line: string }> = {
  upstream: {
    label: "Upstream service",
    line: "A per-person token for a tool.",
  },
  workload: {
    label: "Workload",
    line: "A service signs in with a token this issuer signed.",
  },
};

/**
 * Upstream trust is not built: the platform refuses to add an upstream issuer
 * (409, `not_built: "upstream"`), and nothing calls a tool with a per-person
 * token. The add dialog marks it "Not built" rather than offer it.
 */
export const UPSTREAM_NOT_BUILT = "An issuer can be added for workloads only.";

export const REGISTRATIONS: Record<AuthServerRegistration, { label: string; line: string }> = {
  dynamic: { label: "Dynamic registration", line: "The platform registers itself at the issuer's registration address." },
  metadata: { label: "Hosted metadata", line: "The platform is known by a metadata document it hosts." },
  manual: { label: "Manual", line: "Registered with the issuer by hand; enter the client id." },
};

export const ACTS_AS: Record<AuthServerActsAs, { label: string; line: string }> = {
  person: { label: "Each person", line: "The tool server is called with each person's own token." },
  service_account: { label: "A service account", line: "One account stands for every caller." },
};

const STATE: Record<AuthServerState, { tone: Tone; label: string }> = {
  connected: { tone: "ok", label: "connected" },
  expired: { tone: "warn", label: "expired" },
  unreachable: { tone: "err", label: "unreachable" },
};

export function ServerState({ state }: { state: string }) {
  const s = STATE[state as AuthServerState];
  return <Status tone={s?.tone ?? "neutral"}>{s?.label ?? state}</Status>;
}

/** Whether the methods an issuer advertises include S256; false for none advertised. */
export const hasS256 = (methods: string[] | undefined): boolean => Boolean(methods?.includes("S256"));

/** A subject ending in * admits every subject that starts with what is before it. */
export const subjectKind = (s: string): "prefix" | "exact" => (s.endsWith("*") ? "prefix" : "exact");
