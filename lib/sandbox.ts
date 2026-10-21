import { shortDigest } from "./digest";

/**
 * What an isolated `sandbox.execute` leaves in the journal (phase L6,
 * backend/CONTRACT.md "Isolated execution").
 *
 * With an isolator attached (`docker` with no network, a read-only root and
 * every capability dropped, or gVisor's `runsc`), the code runs in a job of
 * its own over a content-addressed copy-in, bounded in time and output, and
 * the result carries the isolator, the exit, the output and the digest of
 * the manifest that was verified before and after. Without one the call is
 * refused as before, and that refusal renders as any other tool error.
 * These read the result wherever it lands: a `tool.result`'s value, or the
 * data of an entry the runtime journals for the execution itself.
 */

export const SANDBOX_TOOL = "sandbox.execute";

export interface SandboxRun {
  /** The process's exit code; null when the isolator stopped it first (time, output). */
  exit: number | null;
  stdout: string;
  stderr: string;
  /** The output was cut at the bound. */
  truncated: boolean;
  isolator: string;
  /** `sha256:…` over the copied-in files, verified before and after the run. */
  manifest_digest: string;
  duration_ms: number | null;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * The isolated execution a value describes, or null when it describes none.
 * It must name its isolator and carry an exit or a manifest digest; a value
 * may also arrive as the JSON text of one (an MCP text result).
 */
export function sandboxRunOf(value: unknown): SandboxRun | null {
  let v = value;
  if (typeof v === "string" && v.trim().startsWith("{")) {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  const o = obj(v);
  const isolator = typeof o.isolator === "string" ? o.isolator.trim() : "";
  const exit = num(o.exit ?? o.exit_code);
  const manifest = typeof o.manifest_digest === "string" ? o.manifest_digest : "";
  if (!isolator || (exit === null && !manifest)) return null;
  return {
    exit,
    stdout: typeof o.stdout === "string" ? o.stdout : "",
    stderr: typeof o.stderr === "string" ? o.stderr : "",
    truncated: o.truncated === true,
    isolator,
    manifest_digest: manifest,
    duration_ms: num(o.duration_ms),
  };
}

/** Whether a journal entry is about `sandbox.execute`: by the tool it names, or its title. */
export function fromSandbox(e: { title?: string; data?: Record<string, unknown> }): boolean {
  return e.data?.tool === SANDBOX_TOOL || e.title === SANDBOX_TOOL;
}

/** The execution an entry records: a `tool.result` of `sandbox.execute` carries it as its value, any other entry as its data. */
export function sandboxOfEntry(e: { kind: string; title?: string; data?: Record<string, unknown> }): SandboxRun | null {
  if (!fromSandbox(e)) return null;
  return e.kind === "tool.result" ? sandboxRunOf(e.data?.value) : sandboxRunOf(e.data);
}

function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} min`;
}

/** The exit as a reader says it: `exit 0`, `exit 137`, or `no exit` when the isolator stopped the job first. */
export function exitText(s: SandboxRun): string {
  return s.exit === null ? "no exit" : `exit ${s.exit}`;
}

/** One line over a run, for the transcript's collapsed card and the agents view: `exit 0 · docker · 1.2 s · output truncated`. */
export function sandboxLine(s: SandboxRun): string {
  return [exitText(s), s.isolator, s.duration_ms === null ? "" : duration(s.duration_ms), s.truncated ? "output truncated" : ""].filter(Boolean).join(" · ");
}

/** The facts shown above the output, in order, each with the full value where the row shows less. */
export function sandboxFacts(s: SandboxRun): { k: string; v: string; full?: string; tone?: "ok" | "err" | "warn" }[] {
  return [
    { k: "Isolator", v: s.isolator },
    { k: "Exit", v: s.exit === null ? "none" : String(s.exit), tone: s.exit === 0 ? "ok" : "err" },
    { k: "Duration", v: s.duration_ms === null ? "not recorded" : duration(s.duration_ms) },
    { k: "Output", v: s.truncated ? "truncated at the bound" : "complete", tone: s.truncated ? "warn" : undefined },
    { k: "Manifest", v: shortDigest(s.manifest_digest) || "not recorded", full: s.manifest_digest || undefined },
  ];
}
