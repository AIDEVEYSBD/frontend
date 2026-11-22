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
    line: "Trusted to give a per-person token for a tool, so a tool server is called as the person and not with a shared key.",
  },
  workload: {
    label: "Workload",
    line: "A service signs in with a token this issuer signed, sent on every request and checked there against the keys the issuer publishes, so no long-lived key is stored for it. A Kubernetes service account issuer is one.",
  },
};

/**
 * Upstream trust is not built: the platform refuses to add an upstream issuer
 * (409, `not_built: "upstream"`), and nothing calls a tool with a per-person
 * token. The page and the add dialog say so rather than offer it.
 */
export const UPSTREAM_NOT_BUILT = "Not built: the platform refuses to add an upstream issuer (it answers 409 with not_built \"upstream\"), and no tool is called with a per-person token. An issuer can be added for workloads.";

export const REGISTRATIONS: Record<AuthServerRegistration, { label: string; line: string }> = {
  dynamic: { label: "Dynamic registration", line: "The platform registers itself at the address the issuer publishes for that, and keeps the client id it is given." },
  metadata: { label: "Hosted metadata", line: "The platform is known by a metadata document it hosts; the address of that document is its client id." },
  manual: { label: "Manual", line: "Someone registered this deployment with the issuer by hand, and enters the client id here." },
};

export const ACTS_AS: Record<AuthServerActsAs, { label: string; line: string }> = {
  person: { label: "Each person", line: "Every person signs in to the tool once, and the tool server is called with that person's own token." },
  service_account: { label: "A service account", line: "One account stands for every caller: the tool sees the service account, not the person." },
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
