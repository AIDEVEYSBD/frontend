import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMachineRoute, isPublicRoute } from "@/lib/route-policy";

/**
 * The route files and their handlers, read from source. Shared by the
 * coverage test (every handler guarded) and the HTTP walk (every handler
 * answers a viewer the way its guard says).
 */

export const FRONTEND = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type Method = (typeof METHODS)[number];

export type Guard =
  | { kind: "public" }
  | { kind: "machine" }
  | { kind: "permit"; permission: string; first: boolean }
  | { kind: "none" };

export interface Handler {
  file: string;
  method: Method;
  guard: Guard;
}

/**
 * Every route file, as a path relative to frontend/ with forward slashes:
 * under app/api, and under app/.well-known should one come back (the agent
 * card was one until the backend took it in phase L7).
 */
export function routeFiles(): string[] {
  const out: string[] = [];
  for (const dir of ["app/api", "app/.well-known"]) {
    const base = path.join(FRONTEND, dir);
    if (!existsSync(base)) continue;
    for (const rel of readdirSync(base, { recursive: true }) as string[]) {
      if (path.basename(rel) === "route.ts") out.push(path.join(dir, rel).split(path.sep).join("/"));
    }
  }
  return out.sort();
}

function guardOf(file: string, body: string): Guard {
  if (isPublicRoute(file)) return { kind: "public" };
  const machine = /\b(authenticate|admit)\(/.test(body);
  const permit = body.match(/\bpermit\(req, "([a-z]+)"\)/);
  // A handler may carry both: a console route that also honours a key when
  // one is presented (approvals), or a machine door the console reads under
  // its own session (the MCP server's description). The route's nature says
  // which guard is the one that admits.
  if (isMachineRoute(file) && machine) return { kind: "machine" };
  if (permit) {
    // "As its first act": the line after the signature is the gate.
    const first = body.split("\n")[1]?.trim().startsWith("{ const gate = await permit(") ?? false;
    return { kind: "permit", permission: permit[1], first };
  }
  if (machine) return { kind: "machine" };
  return { kind: "none" };
}

/** The exported HTTP handlers of one route file, each with the guard its body carries. */
export function handlersOf(file: string): Handler[] {
  const text = readFileSync(path.join(FRONTEND, file), "utf-8");
  const re = /^export (?:async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/gm;
  const out: Handler[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // A handler ends at the first closing brace in column 0.
    const end = text.indexOf("\n}\n", m.index);
    const body = text.slice(m.index, end === -1 ? undefined : end + 2);
    out.push({ file, method: m[1] as Method, guard: guardOf(file, body) });
  }
  return out;
}

export function isMachine(file: string): boolean {
  return isMachineRoute(file);
}

/** A URL path for the route, with sample values in the dynamic segments. */
export function urlOf(file: string): string {
  let p = file.replace(/^app/, "").replace(/\/route\.ts$/, "");
  p = p.replace(/\/\[\[\.\.\.[^\]]+\]\]/g, "");
  p = p.replace(/\[\.\.\.[^\]]+\]/g, "chat/completions");
  p = p.replace(/\[job\]/g, "job-1");
  p = p.replace(/\[[^\]]+\]/g, "sample-agent");
  return p || "/";
}
