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
    line: "Its tokens may be exchanged by an agent or worker for a short session, so no long-lived key is stored. A Kubernetes service account issuer is one.",
  },
};

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
